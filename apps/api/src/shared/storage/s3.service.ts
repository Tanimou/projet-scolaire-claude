import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * S3 / MinIO wrapper used by the API to persist export artefacts and serve
 * pre-signed download URLs.
 *
 * Env vars (also consumed by the worker):
 *   S3_ENDPOINT     e.g. http://minio:9000 (dev) or empty for AWS S3
 *   S3_REGION       defaults to us-east-1
 *   S3_BUCKET       defaults to "pilotage"
 *   S3_ACCESS_KEY   required
 *   S3_SECRET_KEY   required
 *   S3_FORCE_PATH_STYLE  defaults to true for MinIO compatibility
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
    this.logger.log(
      `S3 client ready (bucket=${this.bucket}, endpoint=${process.env.S3_ENDPOINT ?? 'AWS S3'})`,
    );
  }

  /** Upload a buffer at a given key. Returns the s3:// URI for storage. */
  async putObject(args: {
    key: string;
    body: Buffer | Uint8Array;
    contentType: string;
  }): Promise<{ key: string; bytes: number }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: args.key,
        Body: args.body,
        ContentType: args.contentType,
      }),
    );
    return { key: args.key, bytes: args.body.byteLength };
  }

  /**
   * Generate a time-limited GET URL the caller can hand to the browser.
   * Default TTL = 1 h (matches the bullmq job lifecycle window).
   */
  async signedGetUrl(args: { key: string; expiresInSec?: number; filename?: string }): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: args.key,
      ResponseContentDisposition: args.filename
        ? `attachment; filename="${encodeURIComponent(args.filename)}"`
        : undefined,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: args.expiresInSec ?? 3600 });
  }
}
