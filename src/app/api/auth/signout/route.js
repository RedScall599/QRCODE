import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { token } });
    cookieStore.delete("session");
  }

  return NextResponse.json({ success: true });
}
