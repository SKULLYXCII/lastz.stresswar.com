(function () {
  "use strict";

  const colorPresets = [
    { name: "Gold", value: "#FFD700" },
    { name: "Red", value: "#B22222" },
    { name: "Green", value: "#00CC66" },
    { name: "Blue", value: "#3399FF" },
    { name: "Gray", value: "#AAAAAA" }
  ];

  const composer = document.getElementById("composer");
  const composerFrame = document.querySelector(".composer-frame");
  const hint = document.getElementById("hint");
  const statusMessage = document.getElementById("statusMessage");
  const colorPopover = document.getElementById("colorPopover");
  const generateBtn = document.getElementById("generateBtn");
  const copyBtn = document.getElementById("copyBtn");
  const editBtn = document.getElementById("editBtn");

  let savedRange = null;
  let editHtml = "";
  let generatedCode = "";
  let isCodeMode = false;

  function setStatus(message, isError) {
    statusMessage.textContent = message;
    statusMessage.style.color = isError ? "#ff9b9b" : "";
    if (message) {
      window.clearTimeout(setStatus.timer);
      setStatus.timer = window.setTimeout(() => {
        statusMessage.textContent = "";
        statusMessage.style.color = "";
      }, 2800);
    }
  }

  function setHint(message) {
    hint.textContent = message;
  }

  function normalizeHex(value) {
    const trimmed = value.trim().toUpperCase();
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    return /^#[0-9A-F]{6}$/.test(withHash) ? withHash : null;
  }

  function unitySizeToPreviewPx(value) {
    const size = Number(value);
    if (!Number.isFinite(size)) return 20;
    return Math.round(size * 0.48);
  }

  function selectionIsInComposer() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    return composer.contains(range.commonAncestorContainer);
  }

  function saveSelection() {
    if (isCodeMode || !selectionIsInComposer()) return;
    savedRange = window.getSelection().getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    if (!savedRange) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return true;
  }

  function isEmptyEditor() {
    return composer.textContent.trim() === "" && composer.querySelectorAll("img").length === 0;
  }

  function makeStyledElement(type, value) {
    if (type === "bold") {
      return document.createElement("strong");
    }
    if (type === "underline") {
      return document.createElement("u");
    }
    const span = document.createElement("span");
    if (type === "size") {
      span.dataset.size = String(value);
      span.style.fontSize = `${unitySizeToPreviewPx(value)}px`;
    }
    if (type === "color") {
      span.dataset.color = value;
      span.style.color = value;
    }
    return span;
  }

  function applyStyle(type, value) {
    if (isCodeMode) {
      returnToEdit();
    }

    composer.focus();
    restoreSelection();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selectionIsInComposer()) {
      setHint("Select some text first, then tap a format button.");
      return;
    }

    const range = selection.getRangeAt(0);
    const wrapper = makeStyledElement(type, value);
    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);

    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(wrapper);
    selection.addRange(nextRange);
    savedRange = nextRange.cloneRange();

    setHint("Looks good. Add another style or generate the code.");
  }

  function nodeToUnity(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue.replace(/\u00a0/g, " ");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;
    const tagName = element.tagName.toLowerCase();

    if (tagName === "br") {
      return "\n";
    }

    let content = Array.from(element.childNodes).map(nodeToUnity).join("");

    if (tagName === "div" || tagName === "p") {
      return `${content}\n`;
    }

    if (tagName === "strong" || tagName === "b") {
      return `<b>${content}</b>`;
    }

    if (tagName === "u") {
      return `<u>${content}</u>`;
    }

    if (element.dataset.size) {
      return `<size=${element.dataset.size}>${content}</size>`;
    }

    if (element.dataset.color) {
      return `<color=${element.dataset.color}>${content}</color>`;
    }

    return content;
  }

  function getUnityCode() {
    return Array.from(composer.childNodes).map(nodeToUnity).join("").replace(/\n$/, "");
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      return copied;
    }
  }

  async function generateAndCopy() {
    if (isCodeMode) {
      const copiedAgain = await copyText(generatedCode);
      setStatus(copiedAgain ? "Copied. Paste it into your Last Z game email." : "Copy failed. Press Copy Code.", !copiedAgain);
      return;
    }

    generatedCode = getUnityCode();
    editHtml = composer.innerHTML;

    if (!generatedCode.trim()) {
      setStatus("Type your email first.", true);
      return;
    }

    composer.classList.add("code-mode");
    composerFrame.classList.add("is-code-mode");
    composer.setAttribute("contenteditable", "false");
    composer.textContent = generatedCode;
    isCodeMode = true;
    generateBtn.textContent = "Copy Again";
    copyBtn.hidden = false;
    editBtn.hidden = false;
    colorPopover.hidden = true;

    const copied = await copyText(generatedCode);
    setStatus(copied ? "Generated and copied. Paste it into your Last Z game email." : "Generated. Press Copy Code to try again.", !copied);
  }

  async function copyGenerated() {
    const code = isCodeMode ? generatedCode : getUnityCode();
    if (!code.trim()) {
      setStatus("There is no code to copy yet.", true);
      return;
    }
    const copied = await copyText(code);
    setStatus(copied ? "Copied. Paste it into your Last Z game email." : "Copy failed. Try selecting the code manually.", !copied);
  }

  function returnToEdit() {
    composer.classList.remove("code-mode");
    composerFrame.classList.remove("is-code-mode");
    composer.setAttribute("contenteditable", "true");
    composer.innerHTML = editHtml || "";
    isCodeMode = false;
    generateBtn.textContent = "Generate & Copy";
    copyBtn.hidden = true;
    editBtn.hidden = true;
    composer.focus();
    savedRange = null;
    setHint("Select text, then use the buttons on the right.");
  }

  function clearComposer() {
    if (isEmptyEditor() && !isCodeMode) return;
    if (!window.confirm("Clear this email formatter?")) return;
    composer.classList.remove("code-mode");
    composerFrame.classList.remove("is-code-mode");
    composer.setAttribute("contenteditable", "true");
    composer.innerHTML = "";
    editHtml = "";
    generatedCode = "";
    isCodeMode = false;
    generateBtn.textContent = "Generate & Copy";
    copyBtn.hidden = true;
    editBtn.hidden = true;
    colorPopover.hidden = true;
    savedRange = null;
    composer.focus();
    setStatus("Cleared.");
  }

  function buildColorButtons() {
    const container = document.getElementById("presetColors");
    colorPresets.forEach((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-swatch";
      button.style.background = color.value;
      button.title = color.name;
      button.setAttribute("aria-label", color.name);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        applyStyle("color", color.value);
        colorPopover.hidden = true;
      });
      container.appendChild(button);
    });
  }

  document.addEventListener("selectionchange", saveSelection);
  composer.addEventListener("keyup", saveSelection);
  composer.addEventListener("mouseup", saveSelection);
  composer.addEventListener("input", () => {
    if (!isCodeMode) {
      editHtml = composer.innerHTML;
    }
  });

  document.querySelectorAll(".tool-btn").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
  });

  document.querySelectorAll(".heading-tool").forEach((button) => {
    button.addEventListener("click", () => applyStyle("size", button.dataset.size));
  });
  document.getElementById("boldBtn").addEventListener("click", () => applyStyle("bold"));
  document.getElementById("underlineBtn").addEventListener("click", () => applyStyle("underline"));
  document.getElementById("colorBtn").addEventListener("click", () => {
    colorPopover.hidden = !colorPopover.hidden;
  });
  document.getElementById("customColor").addEventListener("change", (event) => {
    const color = normalizeHex(event.target.value);
    if (color) applyStyle("color", color);
  });
  generateBtn.addEventListener("click", generateAndCopy);
  copyBtn.addEventListener("click", copyGenerated);
  editBtn.addEventListener("click", returnToEdit);
  document.getElementById("clearBtn").addEventListener("click", clearComposer);

  document.addEventListener("click", (event) => {
    const colorButton = document.getElementById("colorBtn");
    if (!colorPopover.hidden && !colorPopover.contains(event.target) && !colorButton.contains(event.target)) {
      colorPopover.hidden = true;
    }
  });

  buildColorButtons();
})();
