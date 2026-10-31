#!/usr/bin/env node
/**
 * preparer.mjs — branche un projet sur le pipeline.
 *
 * Ce que fait ce script, dans l'ordre :
 *   1. lit le jeton maître Cloudflare (~/.cloudflare/cloudflare.token) ;
 *   2. fabrique un jeton Cloudflare **propre à ce projet** ;
 *   3. range sa valeur dans les secrets du dépôt GitHub du projet, chiffrée
 *      localement par `gh secret set` (la valeur ne passe par aucun tiers) ;
 *   4. range l'identifiant de compte en variable, qui n'est pas un secret ;
 *   5. vérifie que le jeton créé répond vraiment.
 *
 * Un projet = un jeton. Révoquer celui d'un projet ne touche à aucun autre.
 *
 * Usage :
 *   node preparer.mjs --depot 6fried/educagames --projet educagames
 *                     [--compte d70d...] [--droits "Workers Scripts Write,D1 Write"]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
}

const depot = args.depot;
const projet = args.projet;
const compte = args.compte || 'd70d084d96430af75fb7c939f8b3eaaa';
const droits = (args.droits || 'Workers Scripts Write,Workers R2 Storage Write,D1 Write')
  .split(',').map((d) => d.trim()).filter(Boolean);

if (!depot || !projet) {
  console.error('il manque --depot owner/repo ou --projet nom');
  process.exit(1);
}

const maitre = readFileSync(join(homedir(), '.cloudflare', 'cloudflare.token'), 'utf8').trim();
const API = 'https://api.cloudflare.com/client/v4';

async function api(chemin, init = {}, jeton = maitre) {
  const r = await fetch(API + chemin, {
    ...init,
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const corps = await r.json();
  if (!corps.success) {
    throw new Error(`${init.method || 'GET'} ${chemin} : ${(corps.errors || []).map((e) => e.message).join(', ')}`);
  }
  return corps.result;
}

/** Les identifiants des droits, retrouvés par leur nom : rien n'est écrit à la main. */
const groupes = await api(`/accounts/${compte}/tokens/permission_groups?per_page=200`);
const parNom = new Map(groupes.map((g) => [g.name, g.id]));
const inconnus = droits.filter((d) => !parNom.has(d));
if (inconnus.length) {
  console.error('droits introuvables :', inconnus.join(', '));
  process.exit(1);
}

const jeton = await api(`/accounts/${compte}/tokens`, {
  method: 'POST',
  body: JSON.stringify({
    name: `ci-${projet}`,
    policies: [{
      effect: 'allow',
      resources: { [`com.cloudflare.api.account.${compte}`]: '*' },
      permission_groups: droits.map((d) => ({ id: parNom.get(d) })),
    }],
  }),
});

// La valeur ne s'affiche qu'une fois : elle va directement dans le secret du
// dépôt, par l'entrée standard, jamais dans un argument de commande.
const gh = { env: { ...process.env, GH_TOKEN: execFileSync('gh', ['auth', 'token', '-u', '6fried'], { encoding: 'utf8' }).trim() } };
execFileSync('gh', ['secret', 'set', 'CLOUDFLARE_API_TOKEN', '-R', depot], { ...gh, input: jeton.value });
execFileSync('gh', ['variable', 'set', 'CLOUDFLARE_ACCOUNT_ID', '-R', depot, '--body', compte], { ...gh });

// Preuve : le jeton neuf doit répondre pour ce compte.
const verif = await fetch(`${API}/accounts/${compte}/workers/scripts`, { headers: { Authorization: `Bearer ${jeton.value}` } });
if (!verif.ok) throw new Error(`le jeton créé ne répond pas (${verif.status})`);

console.log(`projet ${projet} : jeton ${jeton.id} créé (${droits.join(', ')})`);
console.log(`dépôt ${depot} : secret CLOUDFLARE_API_TOKEN posé, variable CLOUDFLARE_ACCOUNT_ID posée`);
console.log(`vérification : le jeton lit les scripts du compte (${verif.status})`);
