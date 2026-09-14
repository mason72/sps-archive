import { foldAccents } from "@/lib/people/name-text";

/**
 * A section, event or person name as one part of a DOWNLOAD filename — the
 * ZIP's own name ("Cafe-Night-Highlights.zip") and its folders.
 *
 * Accents FOLD, they are not deleted. The old rule stripped everything outside
 * `[a-zA-Z0-9-_ ]`, so "José García" became the folder "Jos-Garca" and
 * "Café Night" downloaded as "Caf-Night.zip" — in front of guests. That same
 * class also held a bug: `9-_` inside it is a RANGE (0x39–0x5F), so `: ; < = >
 * ? @ [ \ ] ^` all survived, and a section "Q&A: Panel" made a folder with a
 * colon in it, which Windows refuses to extract.
 *
 * The output stays ASCII on purpose. The ZIP's entry names are UTF-8 flagged
 * (archiver sets it), but unzip tools honour that flag inconsistently, and the
 * sync route's `Content-Disposition` carries only a plain `filename=`. Don't
 * switch to raw UTF-8 without testing macOS Archive Utility and Windows
 * Explorer first.
 *
 * Separators collapse: any run of spaces and hyphens that contains a space is
 * one hyphen ("Q&A - Panel" → "QA-Panel"), while a real hyphen ("Jean-Luc")
 * stays. A name with nothing left (all punctuation, or no Latin letters at
 * all) takes `fallback` rather than producing "-Highlights.zip".
 */
export function asciiFilePart(name: string, fallback: string): string {
  const part = foldAccents(name)
    .replace(/[^A-Za-z0-9_ -]/g, "")
    .trim()
    .replace(/[\s-]*\s[\s-]*/g, "-")
    .replace(/^-+|-+$/g, "");
  return part || fallback;
}

/**
 * One ZIP folder per section, never two sections in one folder.
 *
 * Folding makes names meet: "José" and "Jose" are both `Jose`, and "Q&A:
 * Panel" and "QA Panel" are both `QA-Panel`. Two sections that were already
 * named the same met before folding too. Either way a shared folder writes
 * duplicate entry paths, and unzip tools then ask to overwrite or silently
 * keep one photo. Later sections take `-2`, `-3`, in the order given (pass
 * them in display order so the first keeps the plain name). Compared
 * case-insensitively, because macOS and Windows extract `Jose/` and `JOSE/`
 * into the same folder.
 */
export function uniqueFolderNames(
  sections: readonly { id: string; name: string }[]
): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const s of sections) {
    const base = asciiFilePart(s.name, "Section");
    let folder = base;
    for (let n = 2; used.has(folder.toLowerCase()); n++) folder = `${base}-${n}`;
    used.add(folder.toLowerCase());
    out.set(s.id, folder);
  }
  return out;
}
