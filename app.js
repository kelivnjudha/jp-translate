const SOURCE_MANIFEST_URL = "source_truth/manifest.json";
const TRANSLATED_MANIFEST_URL = "translated_json/JSON/manifest.json";
const SOURCE_LOCALE = "en";

const state = {
  sources: new Map(),
  sourceOrder: [],
  sourceManifestFiles: [],
  existingWorks: [],
  activeSourceId: "",
  translationsBySource: new Map(),
  exportStateBySource: new Map(),
  search: "",
  filter: "all",
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadSourceManifest();
  loadExistingWorkManifest();
  updateStats();
});

function cacheElements() {
  els.manifestList = document.getElementById("manifestList");
  els.languageInput = document.getElementById("languageInput");
  els.translatorNoteInput = document.getElementById("translatorNoteInput");
  els.existingWorkSelect = document.getElementById("existingWorkSelect");
  els.loadExistingWorkButton = document.getElementById("loadExistingWorkButton");
  els.activeSourceTitle = document.getElementById("activeSourceTitle");
  els.activeSourceMeta = document.getElementById("activeSourceMeta");
  els.exportStateBadge = document.getElementById("exportStateBadge");
  els.exportStateDetail = document.getElementById("exportStateDetail");
  els.copyMissingButton = document.getElementById("copyMissingButton");
  els.validateButton = document.getElementById("validateButton");
  els.exportButton = document.getElementById("exportButton");
  els.saveSummaryText = document.getElementById("saveSummaryText");
  els.saveSummaryDetail = document.getElementById("saveSummaryDetail");
  els.totalCount = document.getElementById("totalCount");
  els.translatedCount = document.getElementById("translatedCount");
  els.missingCount = document.getElementById("missingCount");
  els.translatedWordsCount = document.getElementById("translatedWordsCount");
  els.issueCount = document.getElementById("issueCount");
  els.progressPercent = document.getElementById("progressPercent");
  els.searchInput = document.getElementById("searchInput");
  els.filterSelect = document.getElementById("filterSelect");
  els.messageArea = document.getElementById("messageArea");
  els.translationList = document.getElementById("translationList");
  els.rowTemplate = document.getElementById("rowTemplate");
}

function bindEvents() {
  els.languageInput.addEventListener("input", () => {
    markActiveSourceDirty();
    updateActionState();
  });
  els.translatorNoteInput.addEventListener("input", markActiveSourceDirty);
  els.existingWorkSelect.addEventListener("change", () => updateActionState());
  els.loadExistingWorkButton.addEventListener("click", loadSelectedExistingWork);
  els.searchInput.addEventListener("input", () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    renderTranslationList();
  });
  els.filterSelect.addEventListener("change", () => {
    state.filter = els.filterSelect.value;
    renderTranslationList();
  });
  els.copyMissingButton.addEventListener("click", copyEnglishForMissing);
  els.validateButton.addEventListener("click", () => {
    const result = validateActiveSource();
    showValidationResult(result);
  });
  els.exportButton.addEventListener("click", exportActiveJson);
}

async function loadSourceManifest() {
  try {
    const response = await fetch(SOURCE_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest returned ${response.status}`);
    }

    const manifest = await response.json();
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    renderManifest(files);
  } catch (error) {
    const bundledFiles = getBundledSourceFiles();
    if (bundledFiles.length > 0) {
      renderManifest(bundledFiles);
      showMessage("info", "Loaded bundled source truth. For latest source files, use GitHub Pages or a local static server.");
      return;
    }

    els.manifestList.replaceChildren(createMessageNode("warn", "Could not load source truth. Run this site from a static server or GitHub Pages."));
  }
}

function renderManifest(files) {
  els.manifestList.replaceChildren();
  state.sourceManifestFiles = files
    .map((file) => ({
      name: typeof file === "string" ? file : file.name,
      label: typeof file === "string" ? file : file.label || file.name,
    }))
    .filter((file) => file.name);

  if (state.sourceManifestFiles.length === 0) {
    els.manifestList.appendChild(createMessageNode("warn", "No source truth files are listed in source_truth/manifest.json."));
    return;
  }

  state.sourceManifestFiles.forEach((file) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-button";
    button.textContent = file.label;
    button.dataset.fileName = file.name;
    button.addEventListener("click", () => loadManifestSource(file.name, file.label));
    els.manifestList.appendChild(button);
  });

  const firstFile = state.sourceManifestFiles[0];
  loadManifestSource(firstFile.name, firstFile.label);
}

async function loadManifestSource(fileName, label) {
  const cachedSource = findSourceByFileName(fileName);
  if (cachedSource) {
    setActiveSource(cachedSource.id);
    setActiveSourceButton(fileName);
    return cachedSource.id;
  }

  try {
    const response = await fetch(`source_truth/${encodeURIComponent(fileName)}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Source file returned ${response.status}`);
    }
    const text = await response.text();
    const sourceId = addSourceText(fileName, text, label);
    setActiveSourceButton(fileName);
    showMessage("info", `Loaded ${fileName}.`);
    return sourceId;
  } catch (error) {
    const bundledSource = findBundledSourceFile(fileName);
    if (bundledSource) {
      const sourceId = addSourceText(fileName, bundledSource.text, label || bundledSource.label || fileName);
      setActiveSourceButton(fileName);
      showMessage("info", `Loaded bundled source truth for ${fileName}.`);
      return sourceId;
    }

    showMessage("error", `Could not load ${fileName}. Make sure it exists in source_truth and is listed in source_truth/manifest.json.`);
    return "";
  }
}

function getBundledSourceFiles() {
  const bundle = window.JP_TRANSLATE_SOURCE_BUNDLE;
  if (!bundle || !Array.isArray(bundle.files)) return [];
  return bundle.files
    .map((file) => ({
      name: file.name,
      label: file.label || file.name,
    }))
    .filter((file) => file.name);
}

function findBundledSourceFile(fileName) {
  const bundle = window.JP_TRANSLATE_SOURCE_BUNDLE;
  if (!bundle || !Array.isArray(bundle.files)) return null;
  return bundle.files.find((file) => file.name === fileName && typeof file.text === "string") || null;
}

function findSourceByFileName(fileName) {
  return Array.from(state.sources.values()).find((source) => source.fileName === fileName) || null;
}

function setActiveSourceButton(fileName) {
  els.manifestList.querySelectorAll(".source-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.fileName === fileName);
  });
}

function addSourceText(fileName, text, label = fileName) {
  const parsed = parseSourceTruthText(text, fileName);
  const id = `${fileName}:${hashText(text)}`;
  const source = {
    id,
    fileName,
    label,
    text,
    hash: hashText(text),
    items: parsed.items,
    warnings: parsed.warnings,
    duplicateKeys: parsed.duplicateKeys,
  };

  state.sources.set(id, source);
  if (!state.sourceOrder.includes(id)) {
    state.sourceOrder.push(id);
  }
  if (!state.translationsBySource.has(id)) {
    state.translationsBySource.set(id, new Map());
  }
  if (!state.exportStateBySource.has(id)) {
    state.exportStateBySource.set(id, {
      dirty: false,
      lastFileName: "",
      lastStatus: "",
      lastSavedAt: "",
      source: "fresh",
    });
  }
  setActiveSource(id);
  return id;
}

function parseSourceTruthText(text, fileName) {
  const items = [];
  const warnings = [];
  const duplicateKeys = [];
  const seenKeys = new Set();
  const lines = normalizeNewlines(text).split("\n");

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    if (/^KEY\s*\|\s*SOURCE TEXT/i.test(line)) return;

    const item = parseSourceLine(line, lineNumber);
    if (!item) {
      warnings.push(`Line ${lineNumber} in ${fileName} was skipped because it does not look like keyed source truth.`);
      return;
    }
    if (!item.key || !item.source) {
      warnings.push(`Line ${lineNumber} in ${fileName} was skipped because key or source text is missing.`);
      return;
    }
    if (seenKeys.has(item.key)) {
      duplicateKeys.push(item.key);
      return;
    }

    seenKeys.add(item.key);
    items.push({
      ...item,
      lineNumber,
      placeholders: getPlaceholders(item.source),
    });
  });

  return { items, warnings, duplicateKeys: [...new Set(duplicateKeys)] };
}

function parseSourceLine(line, lineNumber) {
  if (line.includes("|")) {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length < 2) return null;

    return {
      key: parts[0],
      source: parts[1],
      location: parts[2] || "",
      note: parts.slice(3).join(" | ").trim(),
      lineNumber,
    };
  }

  if (line.includes("=")) {
    const equalIndex = line.indexOf("=");
    const key = line.slice(0, equalIndex).trim();
    const source = line.slice(equalIndex + 1).trim();
    if (!/^[a-z0-9_.-]+$/i.test(key)) return null;
    return {
      key,
      source,
      location: "",
      note: "",
      lineNumber,
    };
  }

  return null;
}

function setActiveSource(id) {
  state.activeSourceId = id;
  renderActiveSourceHeader();
  renderTranslationList();
  updateStats();
  updateExportStateUI();
  updateActionState();
}

function getActiveSource() {
  return state.sources.get(state.activeSourceId) || null;
}

function getActiveTranslations() {
  if (!state.activeSourceId) return new Map();
  if (!state.translationsBySource.has(state.activeSourceId)) {
    state.translationsBySource.set(state.activeSourceId, new Map());
  }
  return state.translationsBySource.get(state.activeSourceId);
}

function getActiveExportState() {
  if (!state.activeSourceId) {
    return {
      dirty: false,
      lastFileName: "",
      lastStatus: "",
      lastSavedAt: "",
      source: "none",
    };
  }

  if (!state.exportStateBySource.has(state.activeSourceId)) {
    state.exportStateBySource.set(state.activeSourceId, {
      dirty: false,
      lastFileName: "",
      lastStatus: "",
      lastSavedAt: "",
      source: "fresh",
    });
  }

  return state.exportStateBySource.get(state.activeSourceId);
}

function markActiveSourceDirty() {
  if (!state.activeSourceId) return;
  const exportState = getActiveExportState();
  exportState.dirty = true;
  updateExportStateUI();
}

function markActiveSourceLoadedExisting(fileName, status) {
  if (!state.activeSourceId) return;
  state.exportStateBySource.set(state.activeSourceId, {
    dirty: false,
    lastFileName: fileName,
    lastStatus: status || "loaded",
    lastSavedAt: "",
    source: "existing",
  });
  updateExportStateUI();
}

function markActiveSourceExported(fileName, status) {
  if (!state.activeSourceId) return;
  state.exportStateBySource.set(state.activeSourceId, {
    dirty: false,
    lastFileName: fileName,
    lastStatus: status || "draft",
    lastSavedAt: new Date().toISOString(),
    source: "exported",
  });
  updateExportStateUI();
}

function updateExportStateUI() {
  if (!els.exportStateBadge || !els.exportStateDetail) return;
  const source = getActiveSource();
  const exportState = getActiveExportState();

  els.exportStateBadge.className = "export-state-badge";

  if (!source) {
    els.exportStateBadge.textContent = "Not exported";
    els.exportStateBadge.classList.add("is-neutral");
    els.exportStateDetail.textContent = "Choose a source truth file to begin.";
    return;
  }

  if (exportState.dirty && exportState.lastFileName) {
    els.exportStateBadge.textContent = "Unsaved changes";
    els.exportStateBadge.classList.add("is-dirty");
    els.exportStateDetail.textContent = `Last JSON: ${exportState.lastFileName}. Save again before production use.`;
    return;
  }

  if (exportState.dirty) {
    els.exportStateBadge.textContent = "Not saved";
    els.exportStateBadge.classList.add("is-dirty");
    els.exportStateDetail.textContent = "This file has changes that have not been exported to JSON.";
    return;
  }

  if (exportState.lastFileName) {
    els.exportStateBadge.textContent = exportState.lastStatus === "confirmed" ? "Exported JSON" : "Draft JSON";
    els.exportStateBadge.classList.add(exportState.lastStatus === "confirmed" ? "is-saved" : "is-draft");
    els.exportStateDetail.textContent = `${exportState.lastFileName} is loaded/saved for this source truth.`;
    return;
  }

  els.exportStateBadge.textContent = "Not exported";
  els.exportStateBadge.classList.add("is-neutral");
  els.exportStateDetail.textContent = "Save JSON when this file is ready.";
}

function renderActiveSourceHeader() {
  const source = getActiveSource();
  if (!source) {
    els.activeSourceTitle.textContent = "No source truth loaded";
    els.activeSourceMeta.textContent = "Choose a source truth file to begin.";
    return;
  }

  els.activeSourceTitle.textContent = source.label || source.fileName;
  const warnings = [
    `${source.items.length} keyed line${source.items.length === 1 ? "" : "s"}`,
    `source hash ${source.hash}`,
  ];
  if (source.duplicateKeys.length > 0) {
    warnings.push(`${source.duplicateKeys.length} duplicate key${source.duplicateKeys.length === 1 ? "" : "s"} skipped`);
  }
  if (source.warnings.length > 0) {
    warnings.push(`${source.warnings.length} parse warning${source.warnings.length === 1 ? "" : "s"}`);
  }
  els.activeSourceMeta.textContent = warnings.join(" · ");
}

function renderTranslationList() {
  const source = getActiveSource();
  els.translationList.replaceChildren();

  if (!source) {
    els.translationList.appendChild(createEmptyState("Ready when the source truth is.", "Load a file and the translator rows will appear here."));
    return;
  }

  const fragment = document.createDocumentFragment();
  const items = source.items.filter(shouldShowItem);

  if (items.length === 0) {
    fragment.appendChild(createEmptyState("No matching lines.", "Try another search or filter."));
  } else {
    items.forEach((item) => fragment.appendChild(createTranslationRow(item)));
  }

  els.translationList.appendChild(fragment);
}

function createTranslationRow(item) {
  const translations = getActiveTranslations();
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  const textarea = row.querySelector("textarea");
  const keepButton = row.querySelector(".keep-english");
  const clearButton = row.querySelector(".clear-translation");

  row.querySelector(".row-key").textContent = item.key;
  row.querySelector(".source-text").textContent = item.source;
  row.querySelector(".location-text").textContent = item.location ? item.location : "No screen location provided.";
  row.querySelector(".note-text").textContent = item.note ? item.note : "";
  textarea.value = translations.get(item.key) || "";

  textarea.addEventListener("input", () => {
    translations.set(item.key, textarea.value);
    markActiveSourceDirty();
    updateRowState(row, item);
    updateStats();
  });

  keepButton.addEventListener("click", () => {
    translations.set(item.key, item.source);
    markActiveSourceDirty();
    textarea.value = item.source;
    updateRowState(row, item);
    updateStats();
  });

  clearButton.addEventListener("click", () => {
    translations.delete(item.key);
    markActiveSourceDirty();
    textarea.value = "";
    updateRowState(row, item);
    updateStats();
  });

  updateRowState(row, item);
  return row;
}

function updateRowState(row, item) {
  const analysis = analyzeItem(item);
  const status = row.querySelector(".row-status");
  const issues = row.querySelector(".row-issues");

  row.classList.toggle("has-issue", analysis.issues.length > 0);
  status.textContent = analysis.missing
    ? "Missing"
    : analysis.unchanged
      ? "Kept in English"
      : "Translated";
  issues.textContent = analysis.issues.join(" ");
}

function shouldShowItem(item) {
  const analysis = analyzeItem(item);
  const translation = getActiveTranslations().get(item.key) || "";
  const haystack = `${item.key} ${item.source} ${item.location} ${item.note} ${translation}`.toLowerCase();

  if (state.search && !haystack.includes(state.search)) return false;

  switch (state.filter) {
    case "missing":
      return analysis.missing;
    case "translated":
      return !analysis.missing;
    case "issues":
      return analysis.issues.length > 0;
    case "unchanged":
      return analysis.unchanged;
    default:
      return true;
  }
}

function analyzeItem(item) {
  const translation = (getActiveTranslations().get(item.key) || "").trim();
  const missing = translation.length === 0;
  const unchanged = !missing && translation === item.source;
  const issues = [];

  if (!missing) {
    const sourcePlaceholders = getPlaceholders(item.source);
    const translationPlaceholders = getPlaceholders(translation);
    const missingPlaceholders = sourcePlaceholders.filter((placeholder) => !translationPlaceholders.includes(placeholder));
    const extraPlaceholders = translationPlaceholders.filter((placeholder) => !sourcePlaceholders.includes(placeholder));

    if (missingPlaceholders.length > 0) {
      issues.push(`Missing placeholder${missingPlaceholders.length === 1 ? "" : "s"}: ${missingPlaceholders.join(", ")}.`);
    }
    if (extraPlaceholders.length > 0) {
      issues.push(`Unexpected placeholder${extraPlaceholders.length === 1 ? "" : "s"}: ${extraPlaceholders.join(", ")}.`);
    }
  }

  return { missing, unchanged, issues };
}

function updateStats() {
  const source = getActiveSource();
  const items = source ? source.items : [];
  const analyses = items.map(analyzeItem);
  const total = items.length;
  const translated = analyses.filter((item) => !item.missing).length;
  const missing = total - translated;
  const issues = analyses.filter((item) => item.issues.length > 0).length;
  const totalWords = items.reduce((sum, item) => sum + countSourceWords(item.source), 0);
  const translatedWords = items.reduce((sum, item) => {
    const analysis = analyzeItem(item);
    return analysis.missing ? sum : sum + countSourceWords(item.source);
  }, 0);
  const percent = total === 0 ? 0 : Math.round((translated / total) * 100);

  els.totalCount.textContent = String(total);
  els.translatedCount.textContent = String(translated);
  els.missingCount.textContent = String(missing);
  els.translatedWordsCount.textContent = `${translatedWords}/${totalWords}`;
  els.issueCount.textContent = String(issues);
  els.progressPercent.textContent = `${percent}%`;
  els.saveSummaryText.textContent = total === 0 ? "No source loaded" : `${translated}/${total} phrases`;
  els.saveSummaryDetail.textContent =
    total === 0
      ? "Choose a source truth file to begin."
      : `${translatedWords}/${totalWords} words · ${missing} missing · ${issues} issue${issues === 1 ? "" : "s"}`;
  updateExportStateUI();
  updateActionState();
}

function updateActionState() {
  const hasSource = Boolean(getActiveSource());
  els.copyMissingButton.disabled = !hasSource;
  els.validateButton.disabled = !hasSource;
  els.exportButton.disabled = !hasSource;
  els.loadExistingWorkButton.disabled = !els.existingWorkSelect.value;
}

async function loadExistingWorkManifest() {
  try {
    const response = await fetch(TRANSLATED_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest returned ${response.status}`);
    }

    const manifest = await response.json();
    state.existingWorks = normalizeExistingWorkFiles(manifest.files || []);
    renderExistingWorkOptions();
  } catch (error) {
    state.existingWorks = [];
    renderExistingWorkOptions("No existing work manifest found yet.");
  }
}

function normalizeExistingWorkFiles(files) {
  return files
    .map((file) => {
      if (typeof file === "string") {
        return {
          name: file,
          label: file,
          language: "",
          sourceFile: "",
          status: "",
        };
      }

      return {
        name: file.name,
        label: file.label || file.name,
        language: file.language || "",
        sourceFile: file.sourceFile || "",
        status: file.status || "",
      };
    })
    .filter((file) => file.name);
}

function renderExistingWorkOptions(emptyText = "No existing work has been saved yet.") {
  els.existingWorkSelect.replaceChildren();

  const startFreshOption = document.createElement("option");
  startFreshOption.value = "";
  startFreshOption.textContent = state.existingWorks.length > 0 ? "Start fresh - no existing work" : emptyText;
  els.existingWorkSelect.appendChild(startFreshOption);

  state.existingWorks.forEach((work) => {
    const option = document.createElement("option");
    option.value = work.name;
    const details = [work.language, work.status, work.sourceFile].filter(Boolean).join(" · ");
    option.textContent = details ? `${work.label} (${details})` : work.label;
    els.existingWorkSelect.appendChild(option);
  });

  updateActionState();
}

async function loadSelectedExistingWork() {
  const selectedName = els.existingWorkSelect.value;
  if (!selectedName) return;

  try {
    const response = await fetch(`translated_json/JSON/${encodeURIComponent(selectedName)}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Existing work returned ${response.status}`);
    }

    const imported = await response.json();
    await loadExistingWorkPayload(imported, selectedName);
  } catch (error) {
    showMessage("error", `Could not load ${selectedName}. Make sure the JSON exists in translated_json/JSON and is listed in its manifest.`);
  }
}

async function loadExistingWorkPayload(imported, selectedName) {
  const sourceFile = imported.sourceFile || "";
  if (sourceFile) {
    const sourceInfo = state.sourceManifestFiles.find((file) => file.name === sourceFile);
    if (sourceInfo) {
      await loadManifestSource(sourceInfo.name, sourceInfo.label);
    } else {
      showMessage("warn", `${selectedName} references ${sourceFile}, but that source truth file is not listed in source_truth/manifest.json.`);
    }
  }

  const translations =
    imported.messages && typeof imported.messages === "object"
      ? imported.messages
      : imported.translations && typeof imported.translations === "object"
        ? imported.translations
        : imported;
  const result = importTranslationMap(translations);

  if (typeof imported.language === "string" && imported.language.trim()) {
    els.languageInput.value = imported.language.trim();
  }
  if (typeof imported.translatorNote === "string" && imported.translatorNote.trim()) {
    els.translatorNoteInput.value = imported.translatorNote.trim();
  }
  markActiveSourceLoadedExisting(selectedName, imported.status || "loaded");

  const source = getActiveSource();
  const sourceHashWarning =
    imported.sourceHash && source && imported.sourceHash !== source.hash
      ? ` Source hash changed from ${imported.sourceHash} to ${source.hash}; review carefully.`
      : "";

  renderTranslationList();
  updateStats();
  showMessage(
    sourceHashWarning ? "warn" : "info",
    `Loaded ${result.imported} translation${result.imported === 1 ? "" : "s"} from ${selectedName}. ${result.unknown} unknown key${result.unknown === 1 ? "" : "s"} skipped.${sourceHashWarning}`
  );
}

function importTranslationMap(translations) {
  const source = getActiveSource();
  const activeTranslations = getActiveTranslations();
  const validKeys = new Set(source ? source.items.map((item) => item.key) : []);
  let imported = 0;
  let unknown = 0;

  Object.entries(translations || {}).forEach(([key, value]) => {
    if (!validKeys.has(key)) {
      unknown += 1;
      return;
    }
    if (typeof value !== "string") return;
    activeTranslations.set(key, value);
    imported += 1;
  });

  return { imported, unknown };
}

function copyEnglishForMissing() {
  const source = getActiveSource();
  if (!source) return;
  const translations = getActiveTranslations();
  let copied = 0;

  source.items.forEach((item) => {
    const current = (translations.get(item.key) || "").trim();
    if (!current) {
      translations.set(item.key, item.source);
      copied += 1;
    }
  });

  if (copied > 0) {
    markActiveSourceDirty();
  }
  renderTranslationList();
  updateStats();
  showMessage("info", `Kept English for ${copied} missing line${copied === 1 ? "" : "s"}.`);
}

function validateActiveSource() {
  const source = getActiveSource();
  const language = getLanguageCode();
  const errors = [];
  const warnings = [];

  if (!source) {
    errors.push("Load a source truth file first.");
    return { errors, warnings, missing: 0, issueCount: 0 };
  }

  if (!language) {
    errors.push("Enter a language code before exporting.");
  } else if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(language)) {
    errors.push("Use a valid language code such as th, zh, ja, en, or pt-BR.");
  }

  if (source.duplicateKeys.length > 0) {
    errors.push(`Duplicate source truth key${source.duplicateKeys.length === 1 ? "" : "s"} skipped: ${source.duplicateKeys.join(", ")}.`);
  }

  source.warnings.forEach((warning) => warnings.push(warning));

  let missing = 0;
  let issueCount = 0;
  source.items.forEach((item) => {
    const analysis = analyzeItem(item);
    if (analysis.missing) missing += 1;
    if (analysis.issues.length > 0) {
      issueCount += 1;
      errors.push(`${item.key}: ${analysis.issues.join(" ")}`);
    }
  });

  if (missing > 0) {
    warnings.push(`${missing} line${missing === 1 ? "" : "s"} are still blank. Blank means not translated yet.`);
  }

  return { errors, warnings, missing, issueCount };
}

function showValidationResult(result) {
  const parts = [];
  if (result.errors.length === 0 && result.warnings.length === 0) {
    showMessage("info", "Validation passed. This file is ready to export as confirmed JSON.");
    return;
  }

  result.errors.slice(0, 6).forEach((error) => parts.push(`Error: ${error}`));
  result.warnings.slice(0, 6).forEach((warning) => parts.push(`Warning: ${warning}`));
  const hiddenCount = result.errors.length + result.warnings.length - parts.length;
  if (hiddenCount > 0) {
    parts.push(`${hiddenCount} more message${hiddenCount === 1 ? "" : "s"} not shown.`);
  }

  showMessage(result.errors.length > 0 ? "error" : "warn", parts.join(" "));
}

function exportActiveJson() {
  const source = getActiveSource();
  if (!source) return;

  const validation = validateActiveSource();
  if (validation.errors.length > 0) {
    showValidationResult(validation);
    return;
  }

  if (validation.missing > 0) {
    const shouldExportDraft = window.confirm(
      `${validation.missing} translation${validation.missing === 1 ? " is" : "s are"} still blank. Export a draft JSON anyway?`
    );
    if (!shouldExportDraft) return;
  }

  const translations = getActiveTranslations();
  const outputTranslations = {};
  source.items.forEach((item) => {
    const value = (translations.get(item.key) || "").trim();
    if (value) {
      outputTranslations[item.key] = value;
    }
  });

  const language = getLanguageCode();
  const translatedCount = Object.keys(outputTranslations).length;
  const totalWordCount = source.items.reduce((sum, item) => sum + countSourceWords(item.source), 0);
  const translatedWordCount = source.items.reduce((sum, item) => {
    return outputTranslations[item.key] ? sum + countSourceWords(item.source) : sum;
  }, 0);
  const payload = {
    schemaVersion: 1,
    format: "jade-palace-ui-translations",
    language,
    sourceLocale: SOURCE_LOCALE,
    sourceFile: source.fileName,
    sourceHash: source.hash,
    generatedAt: new Date().toISOString(),
    translatorNote: els.translatorNoteInput.value.trim(),
    status: validation.missing > 0 ? "draft" : "confirmed",
    counts: {
      total: source.items.length,
      translated: translatedCount,
      missing: source.items.length - translatedCount,
      sourceWordsTotal: totalWordCount,
      sourceWordsTranslated: translatedWordCount,
      issues: validation.issueCount,
    },
    messages: outputTranslations,
    translations: outputTranslations,
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const fileName = `${stripExtension(source.fileName)}.${language}.json`;
  downloadTextFile(fileName, json, "application/json");
  markActiveSourceExported(fileName, payload.status);
  showMessage("info", `Saved ${fileName}. This JSON is ready for Jade Palace UI loaders via the messages/translations key map.`, {
    reveal: true,
  });
}

function getLanguageCode() {
  return els.languageInput.value.trim().toLowerCase();
}

function countSourceWords(text) {
  const normalized = String(text || "")
    .replace(/\{[a-zA-Z0-9_]+\}/g, " placeholder ")
    .trim();

  if (!normalized) return 0;

  const matches =
    normalized.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?|[\u0E00-\u0E7F]+|[\u3400-\u9FFF]/g) || [];

  return matches.length || 1;
}

function getPlaceholders(text) {
  const matches = text.match(/\{[a-zA-Z0-9_]+\}/g) || [];
  return [...new Set(matches)].sort();
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function hashText(text) {
  let hash = 2166136261;
  const normalized = normalizeNewlines(text);

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stripExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

function downloadTextFile(fileName, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createMessageNode(type, text) {
  const node = document.createElement("div");
  node.className = `message ${type}`;
  node.tabIndex = -1;
  if (type === "error" || type === "warn") {
    node.setAttribute("role", "alert");
  } else {
    node.setAttribute("role", "status");
  }
  node.textContent = text;
  return node;
}

function showMessage(type, text, options = {}) {
  const node = createMessageNode(type, text);
  const shouldReveal = options.reveal ?? (type === "error" || type === "warn");

  els.messageArea.replaceChildren(node);

  if (shouldReveal) {
    requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
      node.focus({ preventScroll: true });
    });
  }
}

function createEmptyState(title, body) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.textContent = body;

  wrapper.append(heading, paragraph);
  return wrapper;
}
