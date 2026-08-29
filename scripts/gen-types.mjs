/**
 * Génère packages/database/src/database.types.ts à partir du schéma PostgREST live.
 *
 * Repli tant que la CLI Supabase (`supabase gen types`) n'est pas utilisable :
 * elle exige un access token ou le mot de passe de la base, non disponibles ici.
 * Dès que la CLI est configurée, préférer `supabase gen types typescript`.
 *
 * Usage : node scripts/gen-types.mjs
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'packages/database/src/database.types.ts');

function loadEnv() {
  const envPath = resolve(ROOT, 'apps/web/.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

/** Traduit un format PostgREST en type TypeScript. */
function tsType(meta, enumNames) {
  const fmt = meta.format ?? '';
  if (fmt.startsWith('public.') && enumNames.has(fmt.slice(7))) {
    return `Database['public']['Enums']['${fmt.slice(7)}']`;
  }
  if (fmt.endsWith('[]')) return 'string[]';
  if (fmt === 'jsonb' || fmt === 'json') return 'Json';
  if (meta.type === 'integer' || meta.type === 'number') return 'number';
  if (meta.type === 'boolean') return 'boolean';
  return 'string';
}

// PostgREST infère une PK sur les vues : seul l'absence de `required` les distingue.
const isView = (schema) => schema.required === undefined;

/** Les PK entières sont des identity/serial : jamais fournies à l'INSERT. */
const isGeneratedPk = (meta) =>
  (meta.description ?? '').includes('<pk/>') && meta.type === 'integer';

/**
 * Reconstruit les relations depuis les annotations `<fk table='x' column='y'/>`
 * de PostgREST. Sans elles, postgrest-js refuse le type (Relationships requis)
 * et ne sait pas typer les selects imbriqués.
 */
function relationships(tableName, props) {
  const out = [];
  for (const [col, meta] of props) {
    const m = (meta.description ?? '').match(
      /<fk table='([^']+)' column='([^']+)'\/>/,
    );
    if (!m) continue;
    out.push(
      `          {\n` +
        `            foreignKeyName: '${tableName}_${col}_fkey';\n` +
        `            columns: ['${col}'];\n` +
        `            isOneToOne: false;\n` +
        `            referencedRelation: '${m[1]}';\n` +
        `            referencedColumns: ['${m[2]}'];\n` +
        `          },`,
    );
  }
  return out.length
    ? `        Relationships: [\n${out.join('\n')}\n        ];`
    : '        Relationships: [];';
}

function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');

  return fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
    .then((r) => {
      if (!r.ok) throw new Error(`PostgREST a répondu ${r.status}`);
      return r.json();
    })
    .then((spec) => {
      const defs = spec.definitions ?? {};

      const enums = {};
      for (const schema of Object.values(defs)) {
        for (const meta of Object.values(schema.properties ?? {})) {
          const fmt = meta.format ?? '';
          if (meta.enum && fmt.startsWith('public.')) enums[fmt.slice(7)] = meta.enum;
        }
      }
      const enumNames = new Set(Object.keys(enums));

      const tables = [];
      const views = [];

      for (const [name, schema] of Object.entries(defs).sort()) {
        const props = Object.entries(schema.properties ?? {});
        const required = new Set(schema.required ?? []);

        const row = props
          .map(([col, meta]) => {
            // NOT NULL sans défaut => requis ; avec défaut => valorisé en base.
            const nonNull = required.has(col) || meta.default !== undefined;
            return `          ${col}: ${tsType(meta, enumNames)}${nonNull ? '' : ' | null'};`;
          })
          .join('\n');

        const rels = relationships(name, props);

        if (isView(schema)) {
          views.push(
            `      ${name}: {\n        Row: {\n${row}\n        };\n${rels}\n      };`,
          );
          continue;
        }

        const insert = props
          .map(([col, meta]) => {
            const t = tsType(meta, enumNames);
            if (isGeneratedPk(meta)) return `          ${col}?: ${t};`;
            // Une colonne avec valeur par défaut n'est jamais obligatoire à
            // l'insertion, même déclarée NOT NULL : PostgREST la range pourtant
            // dans `required`, et la croire imposerait de fournir un
            // `created_at` que la base sait mieux calculer que nous.
            if (required.has(col) && meta.default === undefined) {
              return `          ${col}: ${t};`;
            }
            const nullable = meta.default === undefined ? ' | null' : '';
            return `          ${col}?: ${t}${nullable};`;
          })
          .join('\n');

        const update = props
          .map(([col, meta]) => {
            const t = tsType(meta, enumNames);
            const nullable = required.has(col) || meta.default !== undefined ? '' : ' | null';
            return `          ${col}?: ${t}${nullable};`;
          })
          .join('\n');

        tables.push(
          `      ${name}: {\n        Row: {\n${row}\n        };\n        Insert: {\n${insert}\n        };\n        Update: {\n${update}\n        };\n${rels}\n      };`,
        );
      }

      const enumBlock = Object.entries(enums)
        .sort()
        .map(([n, vals]) => `      ${n}: ${vals.map((v) => `'${v}'`).join(' | ')};`)
        .join('\n');

      const out = `/**
 * Types générés depuis le schéma Supabase live — NE PAS ÉDITER À LA MAIN.
 * Régénérer : npm run gen:types
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
${tables.join('\n')}
    };
    Views: {
${views.join('\n')}
    };
    Functions: {
      current_tenant_id: { Args: Record<string, never>; Returns: string };
      current_user_role: { Args: Record<string, never>; Returns: Database['public']['Enums']['role_app'] };
      gen_code: { Args: { prefixe: string }; Returns: string };
      unaccent: { Args: { '': string }; Returns: string };
      chercher_fournisseurs_similaires: {
        Args: { requete: string; tenant: string; seuil?: number; limite?: number };
        Returns: {
          fournisseur_id: number | null;
          fournisseur_nom: string;
          texte: string;
          similarite: number;
        }[];
      };
    };
    Enums: {
${enumBlock}
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];
`;

      writeFileSync(OUT, out, 'utf8');
      console.log(`✓ ${tables.length} tables, ${views.length} vues, ${Object.keys(enums).length} enums → ${OUT}`);
    });
}

main().catch((e) => {
  console.error('✗ Génération des types échouée :', e.message);
  process.exit(1);
});
