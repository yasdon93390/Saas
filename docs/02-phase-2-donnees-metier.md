# Phase 2 — Données métier

## Ce qui est livré

| Domaine | Détail |
|---------|--------|
| Clients | Création, modification, recherche, archivage et restauration, suspension des relances avec motif, signalement des doublons possibles (même nom ou même email) sans fusion automatique |
| Factures | Création manuelle, liste paginée avec recherche et filtre par statut, fiche détaillée avec historique, brouillon, suspension du suivi, annulation avec motif et confirmation |
| Règlements | Paiements partiels, avoirs et corrections, enregistrés comme opérations non modifiables |
| Import CSV | Assistant en 3 étapes (fichier, colonnes, vérification), contrôle ligne par ligne, rapport d'erreurs téléchargeable, historique des imports |
| Statuts | Calculés par la base, jamais saisis |

## Les règles que le code garantit

**Montants**
- Un montant est un entier en centimes, du fichier CSV jusqu'à la base. Aucun nombre à virgule flottante
  n'intervient : la lecture se fait sur du texte (`src/lib/money`).
- Une saisie ambiguë est refusée. « 1.234 » peut valoir 1 234 € ou 1,234 € : l'application demande de
  préciser le séparateur décimal plutôt que de deviner.
- Le montant réglé d'une facture n'est jamais saisi. La base le recalcule à partir de toutes les opérations,
  dans la même transaction, et refuse tout autre chemin d'écriture, y compris avec la clé d'administration.
- Le réglé ne peut ni dépasser le total (trop-perçu refusé), ni devenir négatif.
- Une opération enregistrée ne se modifie pas et ne se supprime pas. Une erreur se corrige par une
  « correction » en sens inverse, obligatoirement justifiée.

**Statuts** — une seule définition, en SQL, dans l'ordre de priorité :

```
annulée → brouillon → payée → suspendue → partiellement payée → échue → à venir
```

« Aujourd'hui » est évalué dans le fuseau horaire de l'organisation. Une facture partiellement payée dont
l'échéance est dépassée porte en plus l'indicateur « En retard ». Le statut « contestée » arrivera avec les
litiges (phase 5).

**Dates** — le format est choisi par l'utilisateur à l'import, jamais deviné : « 03/04/2026 » est le 3 avril
ou le 4 mars selon le fichier. Les dates impossibles (31/02) sont refusées.

**Idempotence**
- Un double clic sur « Créer la facture » ou « Enregistrer l'opération » ne crée rien en double : chaque
  formulaire porte une clé unique, vérifiée par la base.
- Réimporter un fichier ne crée aucun doublon : une facture dont le numéro existe déjà est ignorée et
  signalée. Si son montant ou son échéance diffèrent, la ligne est signalée « à vérifier manuellement » et
  la facture existante n'est pas modifiée.

**Import**
- Le navigateur n'affiche qu'un aperçu. Le serveur relit et recontrôle lui-même le fichier, à la
  vérification puis de nouveau à l'import.
- Rien n'est écrit avant la confirmation de la troisième étape.
- Une ligne refusée n'empêche pas les autres. Chaque ligne non importée figure au rapport avec son motif.
- Un client est rattaché par son identifiant externe s'il est fourni, sinon par sa raison sociale exacte.
  S'il y a plusieurs correspondances, la ligne est refusée : pas de rattachement au hasard.
- Limites : 2 Mo, 5 000 lignes, fichiers `.csv`. Les fichiers d'anciens Excel (Windows-1252) sont lus
  correctement.
- Le rapport téléchargé neutralise les cellules qu'un tableur exécuterait comme formule.

## Où se trouve quoi

```
supabase/migrations/20261114090000_phase2_business_data.sql   tables, RLS, statut, fonctions
src/lib/money/            lecture et affichage des montants
src/lib/csv/              lecture et écriture CSV
src/lib/import/           dates, correspondance des colonnes, contrôle d'un fichier
src/lib/invoices/         libellés des statuts et des opérations
src/app/o/[orgSlug]/customers/   écrans clients
src/app/o/[orgSlug]/invoices/    écrans factures
src/app/o/[orgSlug]/imports/     assistant, historique, résultat, rapport
tests/fixtures/           les quatre fichiers CSV de test du cahier des charges
```

## Format du fichier CSV

| Colonne | Obligatoire | Remarque |
|---------|:-----------:|----------|
| Numéro de facture | oui | Unique dans l'organisation |
| Client (raison sociale) | oui | Le client est créé s'il n'existe pas |
| Date d'émission | oui | Format choisi à l'import |
| Date d'échéance | oui | Ne peut pas précéder l'émission |
| Montant total TTC | oui | Supérieur à zéro |
| Montant déjà payé | non | Enregistré comme un paiement à la date de l'import |
| Devise | non | Euro uniquement ; devise de l'organisation par défaut |
| Email destinataire | non | |
| Identifiant client externe | non | Sert au rattachement du client |
| Identifiant facture externe | non | |

Les noms de colonnes sont libres : l'assistant propose une correspondance, que vous corrigez si besoin.

## Tests exécutés

| Suite | Total | Dont phase 2 |
|-------|------:|-------------:|
| Unitaires | 159 | 75 |
| Base de données | 64 | 35 |
| Bout en bout (navigateur) | 18 | 9 |

## Critères d'acceptation de la phase 2

| Critère | État | Preuve |
|---------|------|--------|
| Les 4 fichiers de test (valide, doublons, mal formé, dates et montants invalides) donnent le résultat attendu | Vérifié | `tests/unit/import.test.ts`, `tests/e2e/business.spec.ts` |
| Réimporter le même fichier ne crée aucun doublon | Vérifié | `tests/integration/business.test.ts`, `tests/e2e/business.spec.ts` |
| `1 234,56`, `1234.56` et `1.234,56` donnent exactement 123 456 centimes | Vérifié | `tests/unit/money.test.ts` |
| Aucun nombre flottant pour les montants | Vérifié | Test sur les types de colonnes en base ; règle de lint interdisant `parseFloat` et `toFixed` dans `src/` |
| Transitions à venir → échue → partiellement payée → payée, annulée, suspendue | Vérifié | « montants et statuts », « cycle de vie » |
| Solde = total − somme des opérations, garanti par la base | Vérifié | Contrainte + déclencheur, testés avec la clé d'administration |
| Isolation entre organisations sur les nouvelles tables | Vérifié | Lecture, écriture et clés étrangères composites |

## Limites connues et reste à faire

- **Non déployé.** Comme la phase 1, tout a tourné en local.
- **Une facture ne se modifie pas après création** (numéro, dates, montant). Un montant se corrige par un
  avoir ; une erreur de saisie par une annulation puis une nouvelle facture.
- **Pas de colonne « statut » à l'import.** Le statut est calculé ; une facture annulée dans votre outil doit
  être retirée du fichier ou annulée après import.
- **Le montant déjà payé importé est daté du jour de l'import**, faute de date de paiement dans le fichier.
- **Euro uniquement.**
- **Pas de pièces jointes** sur les factures.
- **Pas d'export CSV des factures ni d'indicateurs sur le tableau de bord** : prévus en phase 5.
- **Liste des clients du formulaire de facture limitée à 1 000** ; au-delà, il faudra une recherche.
- **Suspendre les relances n'a pas encore d'effet** : il n'existe aucune relance avant la phase 3.
