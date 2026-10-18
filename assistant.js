(() => {
  "use strict";

  const API_URL = "https://artin-personal-assistant.artinbamooeizowj.workers.dev/api/chat";
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

  const welcomeMessage = "برای پیام دادن به هوش مصنوعی، ابتدا فیلترشکن را روشن کن.\nسلام! من دستیار هوش مصنوعی این سایت هستم. چه کمکی از من برمی‌آید؟";

  function appendInline(parent, source) {
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|\x60[^\x60\n]+\x60)/g;
    let last = 0;
    for (const match of source.matchAll(pattern)) {
      if (match.index > last) parent.appendChild(document.createTextNode(source.slice(last, match.index)));
      const token = match[0];
      let node;
      if (token.startsWith("**") || token.startsWith("__")) {
        node = document.createElement("strong");
        node.textContent = token.slice(2, -2);
      } else if (token.startsWith("`")) {
        node = document.createElement("code");
        node.textContent = token.slice(1, -1);
      } else {
        node = document.createElement("em");
        node.textContent = token.slice(1, -1);
      }
      parent.appendChild(node);
      last = match.index + token.length;
    }
    if (last < source.length) parent.appendChild(document.createTextNode(source.slice(last)));
  }

  function splitTableRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);
    return value.split("|").map(cell => cell.trim());
  }

  function isTableDivider(line) {
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function normalizeHtmlTables(source) {
    const decodeText = value => value
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<\/(?:p|div|li|strong|em|span)>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
    const cellPattern = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    const tablePattern = /<table\b[\s\S]*?<\/table\s*>/gi;
    const toMarkdown = table => {
      const rows = [];
      const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
      let rowMatch;
      while ((rowMatch = rowPattern.exec(table))) {
        const cells = [];
        cellPattern.lastIndex = 0;
        let cellMatch;
        while ((cellMatch = cellPattern.exec(rowMatch[1]))) cells.push(decodeText(cellMatch[2]).trim());
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) {
        const cells = [];
        cellPattern.lastIndex = 0;
        let cellMatch;
        while ((cellMatch = cellPattern.exec(table))) cells.push(decodeText(cellMatch[2]).trim());
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) return decodeText(table);
      const width = Math.max(...rows.map(row => row.length));
      const line = row => "| " + Array.from({length: width}, (_, index) => (row[index] || "").replace(/\|/g, "\\|")).join(" | ") + " |";
      return "\n" + line(rows[0]) + "\n| " + Array(width).fill("---").join(" | ") + " |\n" + rows.slice(1).map(line).join("\n") + "\n";
    };
    let normalized = source.replace(tablePattern, toMarkdown);
    if (!/<table\b/i.test(source) && /<t[dh]\b/i.test(source)) {
      const firstCell = normalized.search(/<t[dh]\b/i);
      const prefix = normalized.slice(0, firstCell);
      normalized = prefix + toMarkdown(normalized.slice(firstCell));
    }
    return normalized.replace(/<\/?(?:tr|td|th)\b[^>]*>/gi, " ");
  }

  function appendSafeHtml(parent, source) {
    const allowed = new Set(["P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "PRE", "CODE", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);
    let html = source;
    if (!/<table\b/i.test(html) && /<(?:tr|td|th)\b/i.test(html)) {
      html = "<table><tbody>" + html + "</tbody></table>";
    }
    const parsed = new DOMParser().parseFromString(html, "text/html");
    function copyNode(sourceNode, targetParent) {
      if (sourceNode.nodeType === Node.TEXT_NODE) {
        targetParent.appendChild(document.createTextNode(sourceNode.nodeValue || ""));
        return;
      }
      if (sourceNode.nodeType !== Node.ELEMENT_NODE) return;
      const tag = sourceNode.tagName;
      if (!allowed.has(tag)) {
        if (!["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "MATH"].includes(tag)) {
          Array.from(sourceNode.childNodes).forEach(child => copyNode(child, targetParent));
        }
        return;
      }
      const clean = document.createElement(tag.toLowerCase());
      if (tag === "TABLE") clean.className = "pa-md-table";
      Array.from(sourceNode.childNodes).forEach(child => copyNode(child, clean));
      targetParent.appendChild(clean);
    }
    Array.from(parsed.body.childNodes).forEach(node => copyNode(node, parent));
  }

  function renderMessageContent(container, content) {
    const source = String(content).replace(/\r\n?/g, "\n");
    if (/<\/?(?:table|thead|tbody|tfoot|tr|th|td|p|ul|ol|li|h[1-6]|pre|blockquote)\b/i.test(source)) {
      const wrapper = document.createElement("div");
      wrapper.className = "pa-html-content";
      appendSafeHtml(wrapper, source);
      wrapper.querySelectorAll("table").forEach(table => {
        const scroll = document.createElement("div");
        scroll.className = "pa-table-wrap";
        table.parentNode.insertBefore(scroll, table);
        scroll.appendChild(table);
      });
      container.appendChild(wrapper);
      return;
    }
    const lines = source.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (/^\s*\x60{3,}/.test(line)) {
        const codeLines = [];
        i++;
        while (i < lines.length && !/^\s*\x60{3,}/.test(lines[i])) codeLines.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }

      if (i + 1 < lines.length && line.includes("|") && isTableDivider(lines[i + 1])) {
        const headers = splitTableRow(line);
        const table = document.createElement("table");
        table.className = "pa-md-table";
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        headers.forEach(value => {
          const th = document.createElement("th");
          appendInline(th, value);
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        i += 2;
        const tbody = document.createElement("tbody");
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          const cells = splitTableRow(lines[i++]);
          const tr = document.createElement("tr");
          headers.forEach((_, index) => {
            const td = document.createElement("td");
            appendInline(td, cells[index] || "");
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        const wrapper = document.createElement("div");
        wrapper.className = "pa-table-wrap";
        wrapper.appendChild(table);
        container.appendChild(wrapper);
        continue;
      }

      const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
      if (heading) {
        const node = document.createElement("h" + Math.min(6, heading[1].length + 1));
        appendInline(node, heading[2]);
        container.appendChild(node);
        i++;
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const list = document.createElement("ul");
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          const li = document.createElement("li");
          appendInline(li, lines[i++].replace(/^\s*[-*+]\s+/, ""));
          list.appendChild(li);
        }
        container.appendChild(list);
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const list = document.createElement("ol");
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          const li = document.createElement("li");
          appendInline(li, lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
          list.appendChild(li);
        }
        container.appendChild(list);
        continue;
      }

      const paragraphLines = [];
      while (i < lines.length && lines[i].trim() &&
        !/^\s*\x60{3,}/.test(lines[i]) &&
        !(i + 1 < lines.length && lines[i].includes("|") && isTableDivider(lines[i + 1])) &&
        !/^\s*#{1,4}\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+[.)]\s+/.test(lines[i])) {
        paragraphLines.push(lines[i++]);
      }
      const p = document.createElement("p");
      paragraphLines.forEach((part, index) => {
        if (index) p.appendChild(document.createElement("br"));
        appendInline(p, part);
      });
      container.appendChild(p);
    }
  }

  function addMessage(role, content, extraClass = "") {
    const item = document.createElement("div");
    item.className = "pa-message pa-" + role + (extraClass ? " " + extraClass : "");
    if (role === "assistant" && !extraClass.includes("pa-typing")) {
      renderMessageContent(item, content);
    } else {
      item.textContent = content;
    }
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
    addMessage("assistant", welcomeMessage);
    status.textContent = "گفت‌وگو پاک شد";
    input.focus();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    if (API_URL.includes("YOUR-SUBDOMAIN")) {
      addMessage("error", "در دسترس نیست");
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
      try { data = await response.json(); } catch { throw new Error("unavailable"); }
      if (!response.ok) throw new Error("unavailable");
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("unavailable");
      typing.remove();
      history.push({ role: "assistant", content: data.reply });
      if (history.length > 10) history = history.slice(-10);
      addMessage("assistant", data.reply);
    } catch {
      typing.remove();
      addMessage("error", "در دسترس نیست");
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

  addMessage("assistant", welcomeMessage);
})();
