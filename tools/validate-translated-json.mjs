import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const sourceDir = path.join(rootDir, "source_truth");
const translatedDir = path.join(rootDir, "translated_json", "JSON");

const sourceManifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
const translatedManifest = JSON.parse(await fs.readFile(path.join(translatedDir, "manifest.json"), "utf8"));
const sourceFiles = new Map();
const errors = [];
const warnings = [];

for (const entry of sourceManifest.files || []) {
  const name = typeof entry === "string" ? entry : entry.name;
  if (!name) continue;

  const text = await fs.readFile(path.join(sourceDir, name), "utf8");
  sourceFiles.set(name, {
    hash: hashText(text),
    items: parseSourceTruthText(text),
  });
}

const translatedFiles = (translatedManifest.files || [])
  .map((entry) => (typeof entry === "string" ? { name: entry } : entry))
  .filter((entry) => entry.name);

if (translatedFiles.length === 0) {
  console.log("No translated JSON files listed in translated_json/JSON/manifest.json.");
  process.exit(0);
}

for (const entry of translatedFiles) {
  await validateTranslatedFile(entry.name);
}

if (warnings.length > 0) {
  console.log("Warnings:");
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

if (errors.length > 0) {
  console.error("Validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated ${translatedFiles.length} translated JSON file${translatedFiles.length === 1 ? "" : "s"}.`);

async function validateTranslatedFile(fileName) {
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(path.join(translatedDir, fileName), "utf8"));
  } catch (error) {
    errors.push(`${fileName}: could not read or parse JSON.`);
    return;
  }

  if (payload.format && payload.format !== "jade-palace-ui-translations") {
    warnings.push(`${fileName}: unexpected format "${payload.format}".`);
  }

  if (payload.schemaVersion !== 1) {
    errors.push(`${fileName}: schemaVersion must be 1.`);
  }

  if (!payload.language || !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(payload.language)) {
    errors.push(`${fileName}: language must be a valid short language code.`);
  }

  if (!payload.sourceFile || !sourceFiles.has(payload.sourceFile)) {
    errors.push(`${fileName}: sourceFile is missing or not listed in source_truth/manifest.json.`);
    return;
  }

  const source = sourceFiles.get(payload.sourceFile);
  if (payload.sourceHash && payload.sourceHash !== source.hash) {
    errors.push(`${fileName}: sourceHash does not match current source truth for ${payload.sourceFile}.`);
  }

  const messages =
    payload.messages && typeof payload.messages === "object"
      ? payload.messages
      : payload.translations && typeof payload.translations === "object"
        ? payload.translations
        : null;

  if (!messages) {
    errors.push(`${fileName}: missing messages/translations object.`);
    return;
  }

  const sourceByKey = new Map(source.items.map((item) => [item.key, item]));
  let translated = 0;
  let issueCount = 0;

  for (const [key, value] of Object.entries(messages)) {
    const sourceItem = sourceByKey.get(key);
    if (!sourceItem) {
      errors.push(`${fileName}: unknown translation key ${key}.`);
      issueCount += 1;
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${fileName}: ${key} must be a non-empty string.`);
      issueCount += 1;
      continue;
    }
    translated += 1;

    const sourcePlaceholders = getPlaceholders(sourceItem.source);
    const translatedPlaceholders = getPlaceholders(value);
    const missing = sourcePlaceholders.filter((placeholder) => !translatedPlaceholders.includes(placeholder));
    const extra = translatedPlaceholders.filter((placeholder) => !sourcePlaceholders.includes(placeholder));

    if (missing.length > 0 || extra.length > 0) {
      errors.push(`${fileName}: ${key} placeholder mismatch.`);
      issueCount += 1;
    }
  }

  const missingCount = source.items.length - translated;
  if (payload.status === "confirmed" && missingCount > 0) {
    errors.push(`${fileName}: confirmed files cannot have missing translations.`);
  }

  if (payload.counts) {
    if (payload.counts.total !== source.items.length) {
      errors.push(`${fileName}: counts.total does not match source truth.`);
    }
    if (payload.counts.translated !== translated) {
      errors.push(`${fileName}: counts.translated does not match messages.`);
    }
    if (payload.counts.missing !== missingCount) {
      errors.push(`${fileName}: counts.missing does not match source truth.`);
    }
    if (payload.counts.issues !== issueCount && payload.status === "confirmed") {
      errors.push(`${fileName}: confirmed file has validation issues.`);
    }
  }
}

function parseSourceTruthText(text) {
  return normalizeNewlines(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^KEY\s*\|\s*SOURCE TEXT/i.test(line) && line.includes("|"))
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return {
        key: parts[0],
        source: parts[1],
      };
    })
    .filter((item) => item.key && item.source);
}

function getPlaceholders(text) {
  return [...new Set(String(text || "").match(/\{[a-zA-Z0-9_]+\}/g) || [])].sort();
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
