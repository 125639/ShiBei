import type { Prisma } from "@prisma/client";

export const publicVideoWhere: Prisma.VideoWhereInput = {
  post: { status: "PUBLISHED" }
};

export function combineVideoWhere(...clauses: Array<Prisma.VideoWhereInput | null | undefined>): Prisma.VideoWhereInput {
  const active = [publicVideoWhere, ...clauses.filter((clause): clause is Prisma.VideoWhereInput => Boolean(clause))];
  return active.length === 1 ? active[0] : { AND: active };
}
