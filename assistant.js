(() => {
  "use strict";

  // Replace this placeholder with your deployed Worker URL ending in /api/chat.
  const API_URL = "https://artin-personal-assistant.YOUR-SUBDOMAIN.workers.dev/api/chat";
  const root = document.getElementById("personalAssistant");
  if (!root) return;

  const toggle = root.querySelector(".pa-toggle");
  const panel = root.querySelector(".pa-panel");
  const close = root.querySelector(".pa-close");
  const clear = root.querySelector(".pa-clear");
  const form = root.querySelector(".pa-form");
  const input = root.querySelector(".pa-input");
  const send = root.querySelector(".pa-send");
  const messagesEl = root.querySelector(".pa-messages");
  const status = root.querySelector(".pa-status");
  let history = [];
  let busy = false;

  function addMessage(role, content, extraClass = "") {
    const item = document.createElement("div");
    item.className = "pa-message pa-" + role + (extraClass ? " " + extraClass : "");
    item.textContent = content;
    messagesEl.appendChild(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return item;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    input.disabled = value;
    send.textContent = value ? "…" : "ارسال";
    status.textContent = value ? "در حال فکر کردن…" : "پاسخ‌ها توسط هوش مصنوعی تولید می‌شوند";
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  clear.addEventListener("click", () => {
    if (busy) return;
    history = [];
    messagesEl.replaceChildren();
    addMessage("assistant", "سلام! من دستیار هوش مصنوعی این سایت هستم. چه کمکی از من برمی‌آید؟");
    status.textContent = "گفت‌وگو پاک شد";
    input.focus();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    if (API_URL.includes("YOUR-SUBDOMAIN")) {
      addMessage("error", "اتصال هنوز تنظیم نشده است. ابتدا Worker را در Cloudflare مستقر کن و نشانی آن را در assistant.js جایگزین کن.");
      return;
    }

    input.value = "";
    history.push({ role: "user", content: text });
    addMessage("user", text);
    const typing = addMessage("assistant", "در حال نوشتن پاسخ…", "pa-typing");
    setBusy(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-10) }),
      });
      let data;
      try { data = await response.json(); } catch { throw new Error("پاسخ نامعتبر از سرور دریافت شد."); }
      if (!response.ok) throw new Error(data.error || "درخواست ناموفق بود (" + response.status + ").");
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("پاسخ خالی دریافت شد.");
      typing.remove();
      history.push({ role: "assistant", content: data.reply });
      if (history.length > 10) history = history.slice(-10);
      addMessage("assistant", data.reply);
    } catch (error) {
      typing.remove();
      const message = error && error.message ? error.message : "خطای ناشناخته";
      addMessage("error", message + (message.includes("Failed to fetch") ? " — نشانی Worker و تنظیمات CORS را بررسی کن." : ""));
      if (history[history.length - 1]?.role === "user") history.pop();
      input.value = text;
    } finally {
      setBusy(false);
      input.focus();
    }
  });

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  addMessage("assistant", "سلام! من دستیار هوش مصنوعی این سایت هستم. می‌توانم به سؤال‌هایت پاسخ بدهم و در برنامه‌ریزی و یادگیری کمکت کنم. برای شروع، چه چیزی در ذهن داری؟");
})();
