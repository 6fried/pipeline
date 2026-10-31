# pipeline

La mécanique de mise en ligne, écrite une fois pour tous les projets de Kelly.

## Deux pièces

- `preparer.mjs` — branche un projet : fabrique un jeton Cloudflare **propre au
  projet**, le range dans les secrets de son dépôt GitHub, pose l'identifiant de
  compte en variable, et vérifie que le jeton répond.
- `.github/workflows/deploiement.yml` — l'enchaînement réutilisable : tests,
  construction, mise en ligne. Aperçu sur la branche `preview`, production sur
  `main`.

## Brancher un projet

```
node preparer.mjs --depot 6fried/educagames --projet educagames
```

Puis, dans le dépôt du projet, un fichier qui appelle l'enchaînement :

```
on:
  push:
    branches: [preview, main]
jobs:
  deploiement:
    uses: 6fried/pipeline/.github/workflows/deploiement.yml@main
    with:
      worker: educagames-web
      dossier: frontend
      construction: npm ci && npx opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion
      apercu: ${{ github.ref_name == 'preview' }}
    secrets: inherit
```

## Règle

Un projet, un jeton. Révoquer celui d'un projet ne touche aucun autre Worker.
Le jeton maître reste sur la machine de Kelly et n'entre jamais dans GitHub.
