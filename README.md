# i18next-cli-comment

> Unofficial fork of [i18next-cli](https://github.com/i18next/i18next-cli): same unified, high-performance i18next CLI toolchain (SWC), plus extensions such as **per-locale strings inside `// t(...)` comments**. Upstream copyright and license: see [LICENSE](./LICENSE).

## An extension for `i18next-cli` that adds automatic language tracking and structured output for translation files.

## ✨ Features

- 🌍 Automatically tracks used languages
- 📁 Stores translations in per-language directories (`/locales/{lang}/}`)
- ✍️ Safely updates files without overwriting other locales
- ⚙️ Flexible path configuration using templates
- 🔄 Fully compatible with existing i18next setups

---

## 📦 Installation

```bash
npm install i18next-cli-comment --save-dev
```

or

```bash
yarn add i18next-cli-comment -D
```

---

## 🚀 Quick Start

Run Initialisation:

```bash
npx i18next-cli-comment init
```

---

## ⚙️ Configuration (i18next.config.ts)


| Option    | Type     | Description                                       |
| --------- | -------- | ------------------------------------------------- |
| `locales` | string[] | List of supported languages                       |
| `output`  | string   | Output path template (`$LOCALE` will be replaced) |
| `input`   | string   | Input path which directory tracking               |


---

## 🧠 How it works

1. The CLI scans your project files
2. Extracts translation keys (e.g. `t('key', {en: 'Some words', ua: 'Будь-які слова'})`)
3. Determines active languages
4. Generates or updates translation files:

```
/locales
  /en
    translation.json
  /ua
    translation.json
  /de
    translation.json
```

---

## 📄 Example

Source code:

```js
//t('key', {en: 'Some words', ua: 'Будь-які слова'})
```

Generated output:

**locales/en/translation.json**

```json
{
  "key": "Some words"
}
```

**locales/ua/translation.json**

```json
{
  "key": "Будь-які слова"
}
```

---

## 🔧 CLI Commands(same from i18next-cli)

```bash
# extract translations
npx i18next-cli-comment extract

# watch mode 
npx i18next-cli-comment extract --watch

# translation status
npx i18next-cli-comment status

# help
npx i18next-cli-comment help

```

---

## ✅ Benefits

- Clean and scalable structure
- Better collaboration in teams

---

## 🔮 Roadmap

- Improve extract method
- Add support for detecting `t()` function calls from i18next-cli
- Fix updating values when new language provided or added

---

## 🤝 Contributing

Contributions and suggestions are welcome!
