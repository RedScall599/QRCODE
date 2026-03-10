import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function DELETE(req, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify the QR code belongs to this user before deleting
  const qrCode = await prisma.qRCode.findUnique({ where: { id } });
  if (!qrCode || qrCode.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.qRCode.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
