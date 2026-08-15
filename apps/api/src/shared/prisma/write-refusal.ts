import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * S-E01-1d §D9 / S-E01-1e — le refus RLS d'une écriture doit garder la MÊME
 * forme HTTP que la garde applicative, sinon le durcissement CRÉE un ORACLE
 * D'EXISTENCE qui n'existait pas avant lui.
 *
 * La garde applicative d'`update` / `remove` renvoie 404 pour une ligne d'un
 * autre tenant. Sous un GUC posé sur une connexion NON propriétaire,
 * `model.update({ where: { id } })` sur une ligne invisible lève `P2025`, que
 * Nest traduit en **500**. Un 500 là où la garde donne un 404 distingue
 * « existe chez un autre tenant » de « n'existe pas ».
 *
 * On mappe donc `P2025` sur `NotFoundException` : le plancher base et la garde
 * applicative deviennent EXTÉRIEUREMENT INDISCERNABLES. La garde applicative
 * n'est PAS supprimée pour autant — défense en profondeur, et la retirer serait
 * un changement de visibilité déguisé en correctif.
 *
 * PARTAGÉ, et c'est le point de cette extraction (S-E01-1e). La fonction était
 * locale et non exportée dans `calendar.controller.ts`. Le module converti n°2
 * en avait besoin à l'identique : une DEUXIÈME copie tenue à la main d'une règle
 * de refus est le défaut que ce dépôt a déjà payé ailleurs, et celui-ci se
 * trompe en silence — une copie qui oublie le mapping ne casse rien, elle rouvre
 * seulement l'oracle.
 *
 * Ce fichier ne connaît AUCUN module : il ne prend qu'une erreur et rend une
 * erreur. Il n'attrape rien lui-même — l'appelant garde son `try/catch` en
 * ligne, dans la portée, là où le compteur lexical le voit.
 */
export function mapWriteRefusal(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    return new NotFoundException();
  }
  return error;
}
