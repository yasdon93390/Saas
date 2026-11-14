# CashPilot AI

SaaS B2B de suivi des factures impayées et de relance amiable assistée par IA.

**État : phases 1 et 2 terminées.** Comptes, organisations, rôles, isolation des données, journal
d'audit, clients, factures, règlements et import CSV. Aucune relance ni IA pour l'instant.

| Document | Contenu |
|----------|---------|
| [docs/00-cadrage-architecture.md](docs/00-cadrage-architecture.md) | Périmètre MVP, décisions, plan en 6 phases, architecture, risques |
| [docs/01-phase-1-fondations.md](docs/01-phase-1-fondations.md) | Ce qui est livré, comment le lancer, ce qui est testé, ce qui reste |
| [docs/02-phase-2-donnees-metier.md](docs/02-phase-2-donnees-metier.md) | Clients, factures, règlements, import CSV : règles garanties, format du fichier, limites |

## Démarrage rapide

Prérequis : Node.js 22, pnpm, Docker Desktop (allumé).

```bash
pnpm install
pnpm supabase:start      # base de données + authentification en local (quelques minutes la 1re fois)
cp .env.example .env.local
# Dans .env.local, collez la valeur « Publishable key » affichée par la commande précédente
# et mettez NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
pnpm dev
```

Ouvrez http://localhost:3000. Les emails de confirmation n'arrivent pas dans une vraie boîte :
ils sont visibles sur http://127.0.0.1:54324.

## Commandes

| Commande | Rôle |
|----------|------|
| `pnpm dev` | Lance l'application en développement |
| `pnpm check` | Lint + typage + tests unitaires + tests de base de données |
| `pnpm test:e2e` | Parcours complets dans un vrai navigateur (nécessite `pnpm supabase:start`) |
| `pnpm supabase:start` / `pnpm supabase:stop` | Démarre / arrête la pile Supabase locale |

## Règles du projet

- Aucun secret dans le dépôt. `.env.local` n'est jamais versionné.
- Toute nouvelle table : `organization_id NOT NULL`, RLS activée et forcée, droits retirés à `anon`.
  Les tests échouent sinon.
- Les utilisateurs n'écrivent jamais directement dans les tables : ils passent par des fonctions SQL
  qui vérifient les droits et écrivent l'audit dans la même transaction.
- Les montants sont des entiers en centimes. Jamais de nombre à virgule flottante.
- Le montant réglé et le statut d'une facture ne sont jamais saisis : la base les calcule.
