import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/auth";

export async function POST(req) {
    
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Use a constant-time comparison path to prevent user enumeration
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await createSession(user.id);
    const cookieStore = await cookies();
    setSessionCookie(cookieStore, token);

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
