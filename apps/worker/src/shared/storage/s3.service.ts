import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Worker-side S3 client. Symmetric to the API S3Service but only needs the
 * upload code path — pre-signed URL generation happens in the API on demand.
 */
@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION ?? 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY ?? 'minio';
    const secretAccessKey = process.env.S3_SECRET_KEY ?? 'miniominio';
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';

    this.bucket = process.env.S3_BUCKET ?? 'pilotage';

    this.client = new S3Client({
      endpoint: endpoint || undefined,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle,
    });
  }

  async onModuleInit() {
    await this.ensureBucket();
    this.logger.log(
      `Worker S3 client ready (bucket=${this.bucket}, endpoint=${process.env.S3_ENDPOINT ?? 'AWS S3'})`,
    );
  }

  /** Create the bucket if missing (dev/MinIO convenience). No-op on AWS prod. */
  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return; // exists
    } catch (err) {
      const status = (err as S3ServiceException)?.$metadata?.httpStatusCode;
      if (status !== 404 && status !== 301) {
        // 301 = wrong region on AWS; 404 = doesn't exist. Anything else = give up
        // and let the caller see the error on first upload.
        this.logger.warn(`HeadBucket failed (${status}); continuing without ensure`);
        return;
      }
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created S3 bucket "${this.bucket}"`);
    } catch (err) {
      this.logger.warn(`CreateBucket failed: ${(err as Error).message}`);
    }
  }

  /** Returns the s3:// URI to persist as `file_url`. */
  async upload(args: { key: string; body: Buffer | Uint8Array; contentType: string }): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: args.key,
        Body: args.body,
        ContentType: args.contentType,
      }),
    );
    return `s3://${this.bucket}/${args.key}`;
  }
}
