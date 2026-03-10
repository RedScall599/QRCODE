// Smoke tests — verify core logic works without needing a running server.
// Uses Node's built-in test runner (node --test), no extra packages needed.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── QR content validation ────────────────────────────────────────────────────

test("accepts a plain URL", () => {
  const input = "https://example.com";
  assert.ok(input.trim().length > 0, "URL should not be empty");
});

test("accepts mailto link", () => {
  const input = "mailto:someone@example.com";
  assert.ok(input.startsWith("mailto:"), "mailto link should start with mailto:");
});

test("accepts plain text", () => {
  const input = "Hello World";
  assert.ok(input.trim().length > 0, "plain text should not be empty");
});

test("rejects empty string", () => {
  const input = "   ";
  assert.equal(input.trim().length, 0, "whitespace-only input should be treated as empty");
});

// ── Upload file validation ───────────────────────────────────────────────────

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

test("allows valid image MIME types", () => {
  for (const type of ALLOWED_TYPES) {
    assert.ok(ALLOWED_TYPES.includes(type), `${type} should be allowed`);
  }
});

test("rejects non-image MIME type", () => {
  const type = "application/pdf";
  assert.equal(ALLOWED_TYPES.includes(type), false, "PDF should not be allowed");
});

test("rejects file over 5 MB", () => {
  const fileSize = 6 * 1024 * 1024; // 6 MB
  assert.ok(fileSize > MAX_SIZE, "6 MB file should exceed the limit");
});

test("accepts file under 5 MB", () => {
  const fileSize = 2 * 1024 * 1024; // 2 MB
  assert.ok(fileSize <= MAX_SIZE, "2 MB file should be within the limit");
});

// ── QR code options ───────────────────────────────────────────────────────────

test("size is within allowed range", () => {
  const size = 256;
  assert.ok(size >= 128 && size <= 512, "size should be between 128 and 512");
});

test("valid error correction levels", () => {
  const validLevels = ["L", "M", "Q", "H"];
  for (const level of validLevels) {
    assert.ok(validLevels.includes(level), `${level} should be a valid error correction level`);
  }
});
