# CLYO Hotels & Resorts — Holding Page

Coming-soon holding page for CLYO Hotels & Resorts. Built with Astro and Tailwind CSS.

## Requirements

- Node.js `>= 22.12.0`
- [pnpm](https://pnpm.io) `11.x` (see `packageManager` in `package.json`)

## Setup

```sh
pnpm install
pnpm dev
```

## Commands

| Command | Action |
| :------ | :----- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start local dev server (`localhost:4321`) |
| `pnpm build` | Build static site to `./dist/` |
| `pnpm preview` | Preview the production build locally |
| `pnpm astro ...` | Run Astro CLI commands |

## Project structure

```text
/
├── public/                 # Static assets (hero image, logos, icons)
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── pages/
│   │   ├── index.astro           # Holding page + waitlist form
│   │   └── privacy-policy.astro
│   └── styles/
│       └── global.css
├── astro.config.mjs
└── package.json
```

## Stack

- [Astro](https://astro.build) (static output)
- [Tailwind CSS](https://tailwindcss.com) v4 via Vite plugin
- Cloudflare Stream for optional hero video
