Translated JSON Folder

Save exported translation JSON files here after review.

Recommended file names:
JP_ADMIN_COMMON_eng.th.json
JPPOS_eng.th.json
JPUI_CUSTOMER_eng.th.json

Draft exports may contain missing translations.
Confirmed production files should have:
- status: "confirmed"
- no missing translations
- no placeholder validation issues

Do not place secrets or app credentials in translation files.

To make an existing file selectable in the translator website, add it to manifest.json.

Example:
{
  "name": "JPPOS_eng.th.json",
  "label": "JPPOS Thai",
  "language": "th",
  "sourceFile": "JPPOS_eng.txt",
  "status": "draft"
}
