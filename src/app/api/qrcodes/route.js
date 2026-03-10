import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET /api/qrcodes — list the current user's saved QR codes
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const qrCodes = await prisma.qRCode.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ qrCodes });
}

// POST /api/qrcodes — save a newly generated QR code
export async function POST(req) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { content, label, size, fgColor, bgColor, errorLevel } = await req.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const qrCode = await prisma.qRCode.create({
    data: {
      userId: user.id,
      content: content.trim(),
      label: label?.trim() || null,
      size: size || 256,
      fgColor: fgColor || "#000000",
      bgColor: bgColor || "#ffffff",
      errorLevel: errorLevel || "M",
    },
  });

  return NextResponse.json({ qrCode }, { status: 201 });
}
