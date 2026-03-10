"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";

export default function Home() {
  const router = useRouter();

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState("generator"); // 'generator' | 'history'

  // ── Chat state ───────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatBottomRef = useRef(null);

  // ── Generator state ──────────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [size, setSize] = useState(256);
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [errorLevel, setErrorLevel] = useState("M");
  const [label, setLabel] = useState("");
  const [inputType, setInputType] = useState("url"); // 'url' | 'image'
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [generated, setGenerated] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);

  // ── History state ────────────────────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const downloadCanvasRef = useRef(null);

  // Check auth on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
        } else {
          router.replace("/auth");
        }
        setAuthLoading(false);
      })
      .catch(() => router.replace("/auth"));
  }, [router]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    const res = await fetch("/api/qrcodes");
    const data = await res.json();
    setHistory(data.qrCodes || []);
    setHistoryLoading(false);
  };

  // Load history when switching to history view
  useEffect(() => {
    if (view === "history" && user) {
      Promise.resolve().then(() => loadHistory());
    }
  }, [view, user]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const generateQR = async () => {
    let qrContent = text.trim();

    if (inputType === "image") {
      if (!imageFile) return;
      setSaving(true);
      const form = new FormData();
      form.append("image", imageFile);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setSaving(false);
        alert(data.error || "Upload failed");
        return;
      }
      qrContent = window.location.origin + data.url;
      setSaving(false);
    } else {
      if (!qrContent) return;
    }

    await QRCode.toCanvas(canvasRef.current, qrContent, {
      width: size,
      color: { dark: fgColor, light: bgColor },
      errorCorrectionLevel: errorLevel,
      margin: 2,
    });
    setGenerated(true);

    if (user) {
      setSaving(true);
      await fetch("/api/qrcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: qrContent, label: label || null, size, fgColor, bgColor, errorLevel }),
      });
      setSaving(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const downloadQR = () => {
    const url = canvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = label ? `${label}.png` : "qrcode.png";
    a.click();
  };

  const downloadHistoryQR = async (qr) => {
    await QRCode.toCanvas(downloadCanvasRef.current, qr.content, {
      width: qr.size,
      color: { dark: qr.fgColor, light: qr.bgColor },
      errorCorrectionLevel: qr.errorLevel,
      margin: 2,
    });
    const url = downloadCanvasRef.current.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${qr.label || "qrcode"}.png`;
    a.click();
  };

  const deleteHistoryQR = async (id) => {
    await fetch(`/api/qrcodes/${id}`, { method: "DELETE" });
    setHistory((prev) => prev.filter((qr) => qr.id !== id));
  };

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/auth");
  };

  const sendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || chatStreaming) return;
    const userMessage = { role: "user", content: chatInput.trim() };
    const history = [...chatMessages, userMessage];
    setChatMessages(history);
    setChatInput("");
    setChatStreaming(true);
    setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") break;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            setChatMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + delta,
              };
              return updated;
            });
          }
        } catch {}
      }
    }
    setChatStreaming(false);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900">
        <p className="text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-900">
      <canvas ref={downloadCanvasRef} className="hidden" />

      {/* ── Header ── */}
      <header className="bg-zinc-800 border-b border-zinc-700 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-zinc-50">QR Generator</h1>
          <div className="flex items-center gap-3">
            {user && (
              <>
                <span className="hidden text-sm text-zinc-400 sm:block">{user.email}</span>
                <button
                  onClick={() => setView(view === "history" ? "generator" : "history")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    view === "history"
                      ? "bg-blue-600 text-white"
                      : "border border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  History
                </button>
                <button
                  onClick={signOut}
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
                >
                  Sign Out
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-6">

        {/* ── History view ── */}
        {view === "history" && user && (
          <div className="mx-auto max-w-lg rounded-2xl bg-zinc-800 p-8 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView("generator")}
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
                >
                  ← Back
                </button>
                <h2 className="text-xl font-bold text-zinc-50">Your QR History</h2>
              </div>
              <button onClick={loadHistory} className="text-xs text-blue-400 hover:underline">
                Refresh
              </button>
            </div>

            {historyLoading ? (
              <p className="py-10 text-center text-zinc-500">Loading…</p>
            ) : history.length === 0 ? (
              <p className="py-10 text-center text-zinc-500">
                No saved QR codes yet.{" "}
                <button onClick={() => setView("generator")} className="text-blue-400 hover:underline">
                  Generate one!
                </button>
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {history.map((qr) => (
                  <div
                    key={qr.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-700 p-4"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {qr.label && (
                        <p className="truncate text-sm font-semibold text-zinc-50">{qr.label}</p>
                      )}
                      <p className="max-w-[220px] truncate text-xs text-zinc-500">{qr.content}</p>
                      <p className="text-xs text-zinc-400">
                        {new Date(qr.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <button
                      onClick={() => downloadHistoryQR(qr)}
                      className="ml-4 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Generator + Chat two-column layout ── */}
        {view === "generator" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

            {/* Left: QR Generator */}
            <div className="rounded-2xl bg-zinc-800 p-8 shadow-lg flex flex-col gap-6">
              <div className="flex flex-col gap-1 text-center">
                <h2 className="text-2xl font-bold text-zinc-50">QR Code Generator</h2>
                <p className="text-sm text-green-400">
                  ✓ Signed in — every QR you generate is auto-saved to your history
                </p>
              </div>

              {/* Input type toggle */}
              <div className="flex rounded-lg border border-zinc-600 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setInputType("url"); setGenerated(false); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    inputType === "url" ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  Link / Text
                </button>
                <button
                  type="button"
                  onClick={() => { setInputType("image"); setGenerated(false); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    inputType === "image" ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  Image
                </button>
              </div>

              {inputType === "url" ? (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-zinc-300">Text or URL</label>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && generateQR()}
                    placeholder="https://example.com"
                    className="w-full rounded-lg border border-zinc-600 bg-zinc-700 px-4 py-2 text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-zinc-300">Upload Image</label>
                  <p className="text-xs text-zinc-500">The image will be hosted and the QR code will open it when scanned.</p>
                  {imagePreview ? (
                    <div className="flex items-center gap-3 rounded-lg border border-zinc-600 bg-zinc-700/40 p-3">
                      <Image src={imagePreview} alt="preview" width={64} height={64} className="h-16 w-16 rounded-lg object-cover border border-zinc-600" />
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <span className="text-sm text-zinc-200 truncate">{imageFile?.name}</span>
                        <span className="text-xs text-zinc-500">{imageFile ? (imageFile.size / 1024).toFixed(1) + " KB" : ""}</span>
                      </div>
                      <button
                        onClick={clearImage}
                        type="button"
                        className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-600 px-4 py-6 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700/40 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M3.75 3h16.5A.75.75 0 0121 3.75v12a.75.75 0 01-.75.75H3.75A.75.75 0 013 15.75v-12A.75.75 0 013.75 3z" />
                      </svg>
                      <span className="text-sm">Click to upload PNG, JPG, GIF, WebP…</span>
                      <span className="text-xs text-zinc-500">Max 5 MB</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                    </label>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-300">
                  Label <span className="font-normal text-zinc-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. My Website, Instagram, Menu"
                  className="w-full rounded-lg border border-zinc-600 bg-zinc-700 px-4 py-2 text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-zinc-300">Size: {size}px</label>
                  <input
                    type="range"
                    min={128}
                    max={512}
                    step={32}
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                    className="accent-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-zinc-300">Error Correction</label>
                  <select
                    value={errorLevel}
                    onChange={(e) => setErrorLevel(e.target.value)}
                    className="rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-2 text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="L">L — Low (7%)</option>
                    <option value="M">M — Medium (15%)</option>
                    <option value="Q">Q — Quartile (25%)</option>
                    <option value="H">H — High (30%)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-zinc-300">Foreground</label>
                  <input
                    type="color"
                    value={fgColor}
                    onChange={(e) => setFgColor(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-lg border border-zinc-600 p-1"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-zinc-300">Background</label>
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-lg border border-zinc-600 p-1"
                  />
                </div>
              </div>

              <button
                onClick={generateQR}
                disabled={(inputType === "url" ? !text.trim() : !imageFile) || saving}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (inputType === "image" ? "Uploading & Generating…" : "Generating & Saving…") : "Generate QR Code"}
              </button>

              <div className="flex flex-col items-center gap-4">
                <canvas ref={canvasRef} className={generated ? "rounded-xl shadow-md" : "hidden"} />
                {generated && (
                  <div className="flex gap-3">
                    <button
                      onClick={downloadQR}
                      className="rounded-lg border border-zinc-600 px-6 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
                    >
                      Download PNG
                    </button>
                    <button
                      onClick={() => setView("history")}
                      className="rounded-lg border border-blue-700 px-6 py-2 text-sm font-medium text-blue-400 hover:bg-blue-950"
                    >
                      View History
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: AI Chat */}
            <div className="rounded-2xl bg-zinc-800 shadow-lg flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
              <div className="px-6 py-4 border-b border-zinc-700">
                <h2 className="text-lg font-bold text-zinc-50">AI Assistant</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Powered by GPT-4o mini</p>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3" style={{ minHeight: 0 }}>
                {chatMessages.length === 0 && (
                  <div className="flex flex-1 items-center justify-center h-full">
                    <p className="text-center text-sm text-zinc-500 px-4">
                      Ask anything — e.g. &quot;What should I put in my QR code?&quot; or &quot;What URL formats work best?&quot;
                    </p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-700 text-zinc-100"
                      }`}
                    >
                      {msg.content || (chatStreaming && i === chatMessages.length - 1 ? "▌" : "")}
                    </div>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>

              <form onSubmit={sendChat} className="px-4 py-4 border-t border-zinc-700 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask anything…"
                  disabled={chatStreaming}
                  className="flex-1 rounded-xl border border-zinc-600 bg-zinc-700 px-4 py-2.5 text-sm text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatStreaming}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

