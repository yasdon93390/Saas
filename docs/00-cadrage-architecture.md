# CashPilot AI — Cadrage technique et architecture (v0.1)

Référence fonctionnelle : cahier des charges v1.0 du 13 novembre 2026.
Statut : **proposition à valider**. Aucun code applicatif n'est écrit à ce stade.

Les numéros entre crochets (ex. [§6.5]) renvoient aux sections du cahier des charges.

---

## 1. Périmètre MVP (sans élargissement)

Le MVP couvre un flux étroit : **import → suivi → relance amiable → compréhension des réponses** [§3].

### Dans le périmètre

| # | Capacité | Section |
|---|----------|---------|
| 1 | Compte, organisation, invitations, 5 rôles (Owner, Admin, Finance, Collaborateur, Lecture seule) | §6.1 |
| 2 | Clients : création, modification, archivage, recherche, suspension des relances avec motif, signalement de doublons sans fusion automatique | §6.2 |
| 3 | Factures : import CSV, création manuelle, paiements partiels, avoirs et corrections par opérations explicites, 8 états | §6.3, §8 |
| 4 | Import CSV : correspondance des colonnes, validation ligne par ligne, rapport d'erreurs téléchargeable, idempotence | §6.4 |
| 5 | Relances : séquences configurables (J-3, J+2, J+7, J+14, J+21), prévisualisation obligatoire, envoi test, garde-fous, mode brouillon par défaut | §6.5, §7.1, §8 |
| 6 | Boîte mail : connexion Gmail ou Microsoft 365 par OAuth, envoi des relances, lecture des réponses | §6.6 |
| 7 | Analyse IA des réponses : 7 classes, extraction date/montant, revue humaine si doute | §7.2 |
| 8 | Promesses de paiement et litiges (suspension automatique des relances) | §6.7, §6.8 |
| 9 | Tableau de bord, rapports, exports CSV, prévision simple et déterministe | §6.9, §6.10 |
| 10 | Abonnement CashPilot via Stripe Billing, quotas appliqués côté serveur | §6.11 |

### Hors périmètre (ne sera pas construit)

Paiements ou prélèvements au nom de l'entreprise, mise en demeure et actions juridiques, calcul
automatique de pénalités, remplacement de l'outil comptable, connexion bancaire et réconciliation,
connecteurs comptables (Pennylane, Sage… → V2), couverture multi-pays, application mobile native [§3].

### Ce que je ne construis pas non plus, par prudence

- Aucune conversion de devise : chaque facture garde sa devise, les totaux sont affichés par devise.
- Aucune réponse automatique aux emails entrants : l'IA propose, l'humain répond.
- Aucun envoi sans approbation tant que l'administrateur n'a pas activé l'automatisation.

---

## 2. Hypothèses et décisions à confirmer

### 2.1 Décisions bloquantes avant la phase 1

| # | Sujet | Ma recommandation | Pourquoi |
|---|-------|-------------------|----------|
| D1 | **Dépôt de code** | Créer un dépôt GitHub **privé** dédié (`cashpilot`) | Le dépôt actuel `-lite-vtc-` est **public**, contient un autre projet et se déploie sur GitHub Pages. Le cahier des charges est marqué confidentiel. |
| D2 | **Hébergement** | Supabase en région UE (Paris ou Francfort) + Vercel avec fonctions en région UE | Cohérent avec « conception européenne » [§1]. Vercel et Supabase sont des sociétés américaines : sous-traitants à déclarer, clauses contractuelles à vérifier. |
| D3 | **Fournisseur IA** | OpenAI comme prévu [§9], derrière une interface interne `AiProvider`, avec résidence des données UE et non-rétention si le contrat le permet | Permet de changer de fournisseur sans réécrire les agents [§18 dépendance fournisseurs]. À valider juridiquement. |
| D4 | **Premier fournisseur email** | Gmail d'abord, Microsoft 365 ensuite, dans la même phase 4 | Une seule intégration à fiabiliser à la fois [règle de cadrage §3]. À inverser si vos pilotes sont majoritairement sur Microsoft. |
| D5 | **Politique d'envoi** | Approbation humaine systématique de chaque relance au lancement, automatisation activable par organisation ensuite | Décision ouverte de l'annexe A ; c'est l'option la plus sûre. |

### 2.2 Décisions de conception (je propose, vous validez)

| # | Sujet | Proposition |
|---|-------|-------------|
| D6 | **Organisation active** | Dans l'URL : `/o/[orgSlug]/factures`. Le serveur vérifie l'appartenance à chaque requête. Plus sûr qu'un cookie quand plusieurs onglets sont ouverts sur des organisations différentes. |
| D7 | **Statut d'une facture** | Le statut n'est **pas saisi librement** : il est calculé par le code à partir de faits stockés (solde, échéance, annulation, suspension, litige ouvert). Voir §4.5. |
| D8 | **Facture à la fois partiellement payée et échue** | Le cahier des charges ne tranche pas. Je propose un statut principal + un indicateur « en retard » distinct, pour ne perdre aucune information. |
| D9 | **Avoirs et corrections** | Enregistrés dans la table des paiements avec un type (`payment`, `credit_note`, `correction`), jamais par modification directe du montant payé. |
| D10 | **Trop-perçu** | Un paiement supérieur au solde restant est refusé avec un message clair (pas de solde négatif au MVP). |
| D11 | **Matrice des permissions** | Voir §4.4. Le rôle « Collaborateur » est flou dans le cahier des charges (« tâches autorisées ») : je propose qu'il puisse traiter la boîte de réception et les tâches, sans envoyer de relance ni modifier de montant. |
| D12 | **Synchronisation email** | Interrogation périodique (polling incrémental toutes les quelques minutes) au MVP ; notifications push plus tard. Plus simple à fiabiliser. |
| D13 | **Jours ouvrés** | Lundi–vendredi + jours fériés français, plage horaire configurable par organisation (défaut 9 h–18 h, fuseau de l'organisation). |
| D14 | **Langues** | Interface en français, code prêt pour la traduction. Relances en français et en anglais selon la langue du client. |
| D15 | **Méthode de prévision** | *Certain* : promesses confirmées, à la date promise. *Probable* : factures non échues, à l'échéance décalée du retard moyen historique du client. *Incertain* : factures échues sans promesse. Litiges et suspensions affichés à part, hors total. « Données insuffisantes » sous 3 factures payées pour un client. |
| D16 | **Limites par plan** | Stockées dans une table `plans` (pas dans le code), avec des valeurs provisoires à ajuster : factures actives, utilisateurs, boîtes mail, analyses IA/mois. |
| D17 | **Essai gratuit** | 14 jours sans carte bancaire — à confirmer commercialement [§4]. |

### 2.3 Décisions métier et juridiques (de votre côté)

- Nom commercial, domaine, marque [annexe A].
- Durées de conservation : emails, pièces jointes, journaux d'audit, analyses IA [annexe A]. Valeurs techniques par défaut proposées : emails 24 mois, audit 5 ans, journaux IA 12 mois — **à valider par un juriste**.
- CGU, politique de confidentialité, accord de sous-traitance (DPA), revue juridique des pratiques de relance.
- Phase 0 (30 entretiens, 5 pilotes) : elle ne dépend pas du code et peut avancer en parallèle.

### 2.4 Écarts assumés par rapport au cahier des charges

| Élément du cahier des charges | Ajustement | Raison |
|-------------------------------|-----------|--------|
| Table `users` [§10] | Remplacée par `profiles`, liée à `auth.users` de Supabase | Supabase Auth gère déjà les comptes. |
| `invoices.paid_minor`, `invoices.status` | Maintenus par la base à partir des paiements, non modifiables directement | « Ne jamais recalculer un montant à partir d'un texte IA » [§6.3]. |
| Tables absentes du §10 | Ajout de `tasks`, `import_batches`, `import_rows`, `webhook_events`, `idempotency_keys`, `invoice_events`, `plans`, `usage_counters`, `organization_settings`, `integration_secrets` | Le cahier des charges demande ces comportements (tâches §7.2, rapport d'import §6.4, webhooks dédupliqués §9, quotas §6.11) sans prévoir où les stocker. |

---

## 3. Plan de développement

Les phases 0 (validation commerciale) et 7 (bêta payante) du cahier des charges sont des phases
métier. Les phases 1 à 6 ci-dessous sont les phases de construction.

Pour **chaque** phase, je livre : migrations SQL, validation, logique serveur, interface, tests,
commandes d'installation expliquées, et la liste précise de ce qui reste à faire [§19].

### Phase 1 — Fondations

**Livrables**
- Projet Next.js + TypeScript + Tailwind + shadcn/ui, structure de dossiers du §9.
- Supabase en local, migrations versionnées, fichier `.env.example` sans aucun secret.
- Inscription, vérification d'email, connexion, récupération de mot de passe.
- Création d'organisation, invitations, rôles, changement d'organisation active.
- Module de permissions serveur, module d'audit, RLS sur toutes les tables.
- Coquille d'interface : barre latérale, en-tête, états vides, page « accès refusé ».
- Intégration continue : lint, typage, tests à chaque push.

**Critères d'acceptation**
- Un utilisateur de l'organisation A ne peut lire, modifier ni supprimer aucune ligne de l'organisation B — vérifié par des tests automatisés exécutés contre la vraie base, table par table.
- Chaque table métier a la RLS activée ; un test échoue si une nouvelle table est créée sans politique.
- Un membre « Lecture seule » reçoit une erreur 403 sur toute route d'écriture.
- Les connexions, invitations et changements de rôle apparaissent dans le journal d'audit.
- Le dernier Owner d'une organisation ne peut pas être retiré ni rétrogradé.

### Phase 2 — Données métier

**Livrables**
- Clients et factures : listes paginées, filtres, recherche, fiche détail avec chronologie.
- Paiements partiels, avoirs, corrections, annulation, suspension — chacun tracé.
- Assistant d'import CSV en étapes, rapport d'erreurs téléchargeable, détection de doublons.
- Calcul déterministe des statuts.

**Critères d'acceptation**
- Les 4 fichiers de test du §15 (valide, doublons, mal formé, dates/montants invalides) produisent le résultat attendu.
- Réimporter le même fichier ne crée aucun doublon.
- `1 234,56`, `1234.56` et `1.234,56` donnent tous exactement 123 456 centimes ; aucun nombre flottant dans le code des montants (règle de lint).
- Transitions vérifiées : à venir → échue, échue → partiellement payée, partiellement payée → payée, annulée, suspendue.
- Le solde restant est toujours égal au total moins la somme des opérations, vérifié par une contrainte en base.

### Phase 3 — Relances

**Livrables**
- Éditeur de séquences et d'étapes, modèles avec variables validées, prévisualisation.
- Planification, file d'approbation, garde-fous avant envoi, coupe-circuit global.
- Envoi via un **faux fournisseur d'email** (les messages sont enregistrés, pas envoyés) et envoi test vers l'adresse de l'utilisateur via Resend.
- Journal d'exécution des automatisations.

**Critères d'acceptation**
- Un job relancé 10 fois produit **un seul** envoi (test automatisé).
- Aucune relance n'est planifiée ni envoyée pour une facture payée, annulée, contestée ou suspendue, même si son état change entre la planification et l'envoi.
- Aucun envoi hors plage horaire, hors jours ouvrés ou au-delà des limites quotidiennes.
- Une séquence neuve est inactive ; l'activer exige une prévisualisation et une confirmation explicite.
- Le coupe-circuit arrête tous les envois de l'organisation en une action.

### Phase 4 — Email et IA

**Livrables**
- Connexion et déconnexion OAuth Gmail, puis Microsoft 365 ; jetons chiffrés.
- Envoi réel des relances depuis la boîte du client, synchronisation des réponses.
- Rattachement email → client → facture, avec revue humaine si incertain.
- Agent Analyst (classification, extraction) et agent Collector (rédaction), sorties validées par schéma.
- Boîte de réception IA : message d'origine, analyse, action proposée, correction possible.
- Jeu d'évaluation : environ 150 emails fictifs annotés, dont des tentatives d'injection.

**Critères d'acceptation**
- Précision et rappel mesurés par classe sur le jeu d'évaluation, seuils fixés ensemble avant mise en service.
- Un email contenant des instructions malveillantes ne déclenche aucune action et ne modifie aucun statut (tests dédiés).
- Aucun jeton OAuth n'apparaît dans le navigateur, les réponses d'API ni les journaux (test automatisé).
- « Nous avons payé hier » crée une tâche de vérification et ne marque jamais la facture payée.
- Un message rédigé par l'IA contenant un montant, une date ou une référence qui ne vient pas du serveur est rejeté avant envoi.

### Phase 5 — Litiges, promesses et prévisions

**Livrables**
- Dossiers de litige, promesses, demandes de délai, tâches et notifications.
- Suspension automatique des relances à l'ouverture d'un litige, reprise avec validation.
- Moteur de prévision déterministe, tableau de bord, rapports, exports CSV.
- Agent Forecast : commentaire explicatif, sans chiffre inventé.

**Critères d'acceptation**
- Ouvrir un litige suspend les relances ; le résoudre ne les reprend qu'après validation tracée.
- Une promesse ne change jamais le statut de la facture ; une promesse dépassée crée une tâche.
- Chaque indicateur du tableau de bord renvoie à la liste exacte des factures qui le composent, et la somme correspond au centime.
- La prévision est reproductible : mêmes données, même résultat. Les chiffres cités par l'IA sont vérifiés contre ceux du moteur.

### Phase 6 — Commercialisation

**Livrables**
- Stripe Billing : essai, abonnement, échec de paiement, période de grâce, suspension, changement de plan, résiliation, portail client.
- Quotas appliqués côté serveur, affichage des consommations.
- Export complet des données d'une organisation, suppression, déconnexion des intégrations.
- Sentry, journaux structurés, alertes, environnement de staging, tests de bout en bout Playwright.
- Documentation d'exploitation : sauvegardes, restauration testée, procédure d'incident.

**Critères d'acceptation**
- Un webhook Stripe falsifié est rejeté ; un webhook rejoué n'a aucun effet supplémentaire.
- Un appel d'API direct ne permet pas de dépasser un quota ni d'agir sans abonnement actif.
- Tous les critères de sortie du MVP [§15] sont vérifiés sur staging.

---

## 4. Architecture

### 4.1 Vue d'ensemble

```
Navigateur
   │  (aucun secret, aucun jeton OAuth)
   ▼
Next.js — routes serveur et Server Actions
   │  1. authentifier l'utilisateur
   │  2. résoudre l'organisation active et vérifier l'appartenance
   │  3. vérifier la permission pour l'action
   │  4. valider l'entrée (Zod)
   ▼
Services métier (src/services) ── calculs, transitions, garde-fous
   │                    │
   ▼                    ▼
PostgreSQL (Supabase)   File de jobs (Trigger.dev)
RLS + contraintes       │  relit la base et recontrôle tout avant d'agir
   ▲                    ▼
   │              Adaptateurs externes : Gmail / Microsoft, OpenAI, Resend, Stripe
   │
Webhooks entrants ── signature vérifiée → dédupliqués → journalisés
```

**Règle de dépendance** : l'interface appelle les services ; les services appellent la base et
les adaptateurs ; les agents IA ne connaissent ni la base ni les adaptateurs.

### 4.2 Les trois barrières d'isolation

Chaque barrière fonctionne même si les deux autres échouent.

1. **Permissions serveur.** Une seule fonction d'entrée, `requireOrgContext(orgSlug, permission)`,
   appelée au début de chaque route. Elle renvoie 401, 403 ou un contexte `{ userId, orgId, role }`.
2. **RLS PostgreSQL.** Les requêtes déclenchées par un utilisateur passent par un client Supabase
   porteur de **son** jeton de session. La base refuse elle-même toute ligne d'une autre organisation.
3. **Clés étrangères composites.** Une facture ne peut pas pointer vers le client d'une autre
   organisation, même en cas d'erreur de code, même avec la clé d'administration.

La clé d'administration Supabase (`service_role`, qui contourne la RLS) n'est utilisée que dans
les jobs et les webhooks, via un module unique qui exige un `organizationId` explicite. Une règle
de lint interdit de l'importer ailleurs.

### 4.3 Modèle de données multi-tenant

**Conventions communes à toutes les tables métier**

```sql
id               uuid primary key default gen_random_uuid(),
organization_id  uuid not null references organizations(id),
created_at       timestamptz not null default now(),
updated_at       timestamptz not null default now(),
created_by       uuid references auth.users(id),
unique (organization_id, id)          -- cible des clés étrangères composites
```

**Exemple de clé étrangère composite et de politique RLS**

```sql
create table invoices (
  ...
  customer_id uuid not null,
  foreign key (organization_id, customer_id)
    references customers (organization_id, id)
);

alter table invoices enable row level security;
alter table invoices force row level security;

create policy invoices_select on invoices for select to authenticated
  using (private.is_org_member(organization_id));

create policy invoices_write on invoices for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner','admin','finance']));
```

`private.is_org_member` et `private.has_org_role` sont des fonctions `security definer` placées
dans un schéma non exposé par l'API, avec `search_path` fixé. Elles lisent `organization_members`
pour l'utilisateur courant (`auth.uid()`), en ne retenant que les membres au statut `active`.

**Tables**

| Domaine | Table | Points clés |
|---------|-------|-------------|
| Identité | `organizations` | nom, slug, pays, fuseau, devise par défaut |
| | `profiles` | 1–1 avec `auth.users` ; nom affiché |
| | `organization_members` | rôle, statut (`invited`, `active`, `disabled`) ; l'invitation est liée à l'adresse email vérifiée, sans lien secret |
| | `organization_settings` | plages d'envoi, limites quotidiennes, seuil de confiance IA, **coupe-circuit**, automatisation activée ou non |
| Métier | `customers` | unicité `(organization_id, source, external_id)` ; suspension + motif |
| | `invoices` | `total_minor bigint`, `paid_minor bigint` (maintenu par la base), `currency char(3)`, faits de cycle de vie |
| | `payments` | type `payment` / `credit_note` / `correction` ; **ajout seul**, une erreur se corrige par une écriture inverse |
| | `invoice_events` | chronologie de la facture, ajout seul |
| Import | `import_batches` | empreinte SHA-256 du fichier, correspondance des colonnes, compteurs, auteur |
| | `import_rows` | numéro de ligne, résultat (`imported`, `skipped`, `error`), motif |
| Relances | `reminder_sequences`, `reminder_steps` | inactives par défaut ; modèle + canal + décalage en jours |
| | `reminders` | unicité `(organization_id, invoice_id, step_id)` ; clé d'idempotence ; contenu figé à l'approbation |
| Email | `integrations` | fournisseur, statut, scopes, connecté par |
| | `integration_secrets` | jetons chiffrés ; **aucune politique RLS pour les utilisateurs** : seul le serveur y accède |
| | `email_messages` | unicité `(organization_id, integration_id, provider_message_id)` ; corps stocké à part |
| IA | `ai_analyses` | modèle, version de prompt, identifiant de requête, sortie structurée, coût |
| Suivi | `payment_promises`, `disputes`, `tasks`, `notifications` | une promesse ne touche jamais au solde |
| Système | `automation_jobs` | clé d'idempotence unique, tentatives, statut, file d'échec |
| | `webhook_events` | unicité `(provider, event_id)` |
| | `idempotency_keys` | clés fournies par le client pour les créations et envois |
| | `audit_logs` | **ajout seul**, modification et suppression bloquées par déclencheur |
| Facturation | `plans` (table globale), `subscriptions`, `usage_counters` | quotas lus côté serveur uniquement |

`plans` est la seule table globale ; elle ne contient aucune donnée client.

### 4.4 Matrice des permissions (proposition D11)

| Action | Owner | Admin | Finance | Collaborateur | Lecture seule |
|--------|:-----:|:-----:|:-------:|:-------------:|:-------------:|
| Consulter factures, clients, tableaux de bord | ✓ | ✓ | ✓ | ✓ | ✓ |
| Traiter une tâche, classer un email, ajouter une note | ✓ | ✓ | ✓ | ✓ | — |
| Créer ou modifier clients et factures, importer un CSV | ✓ | ✓ | ✓ | — | — |
| Enregistrer un paiement, un avoir, ouvrir ou résoudre un litige | ✓ | ✓ | ✓ | — | — |
| Approuver ou envoyer une relance | ✓ | ✓ | ✓ | — | — |
| Exporter des données | ✓ | ✓ | ✓ | — | — |
| Modifier séquences, règles, activer l'automatisation | ✓ | ✓ | — | — | — |
| Gérer membres et rôles, connecter une boîte mail | ✓ | ✓ | — | — | — |
| Abonnement, suppression de l'organisation, export complet | ✓ | — | — | — | — |

Cette matrice vit dans un seul fichier TypeScript et est reflétée dans les politiques RLS.
Des tests vérifient chaque case.

### 4.5 Montants et statuts : ce que le code garantit

**Montants**
- Entiers en unités mineures (`bigint`), jamais de nombre flottant. Type TypeScript dédié `Money { amountMinor: bigint; currency }`.
- L'analyse des montants CSV travaille sur du texte et rejette toute valeur ambiguë plutôt que de deviner.
- Contraintes en base : `total_minor >= 0`, `0 <= paid_minor <= total_minor`, devise du paiement = devise de la facture.
- `paid_minor` est recalculé par un déclencheur à chaque écriture dans `payments`, dans la même transaction.

**Statut calculé (D7)** — une seule fonction SQL, utilisée partout, ordre de priorité :

```
annulée → brouillon → payée (solde = 0) → contestée (litige ouvert)
→ suspendue → partiellement payée (0 < payé < total) → échue (échéance < aujourd'hui) → à venir
```

« Aujourd'hui » est évalué dans le fuseau de l'organisation. L'indicateur `is_overdue` est exposé
séparément (D8). Comme le statut est calculé à la lecture, aucune facture ne reste dans un statut
périmé parce qu'un job nocturne aurait échoué.

### 4.6 Idempotence

| Opération | Mécanisme |
|-----------|-----------|
| Import CSV | Empreinte du fichier + unicité `(organization_id, source, external_id)` ; une ligne déjà connue est signalée, pas dupliquée |
| Création via l'API | En-tête `Idempotency-Key`, résultat mémorisé dans `idempotency_keys` |
| Planification d'une relance | Unicité `(organization_id, invoice_id, step_id)` |
| Envoi d'une relance | Voir ci-dessous |
| Webhooks | Unicité `(provider, event_id)` : insertion d'abord, traitement seulement si l'insertion réussit |
| Synchronisation email | Unicité sur l'identifiant de message du fournisseur |

**Envoi d'une relance, étape par étape**

1. Le job prend la relance par une mise à jour atomique `approved → sending`. Si aucune ligne n'est modifiée, un autre job l'a déjà prise : il s'arrête.
2. Tous les garde-fous du §8 sont revérifiés sur des données fraîches. Un seul échec → statut `cancelled` avec le motif.
3. Écriture du journal d'audit, puis appel au fournisseur avec un identifiant de message généré à l'avance.
4. Succès → `sent`. Échec net → `failed`, nouvelle tentative avec délai croissant.
5. **Cas incertain** (coupure après l'appel, avant la confirmation) : la relance reste en `sending` et n'est **jamais** renvoyée à l'aveugle. Un job de réconciliation cherche l'identifiant dans les messages envoyés du fournisseur ; s'il ne peut pas conclure, il crée une tâche pour un humain.

Entre « envoyer peut-être deux fois » et « demander à un humain », le système choisit toujours le second.

### 4.7 Frontière IA

Les agents sont des fonctions sans effet de bord : contexte structuré en entrée, JSON validé par
schéma en sortie. Ils n'ont ni outil, ni accès à la base, ni accès réseau.

**Collector (rédaction)**
- L'IA n'écrit jamais un montant, une date, une référence ou un IBAN. Elle écrit des emplacements : `{{montant_restant}}`, `{{date_echeance}}`, `{{reference_facture}}`.
- Le serveur remplace les emplacements par les valeurs de la base, mises en forme par du code.
- Avant envoi, un contrôle rejette tout message contenant un emplacement inconnu, ou un motif ressemblant à un montant, une date ou un IBAN hors des valeurs injectées, ou un vocabulaire interdit (menace juridique, pénalités, frais).

**Analyst (compréhension)**
- Le serveur présélectionne les factures candidates ; l'IA choisit parmi cette liste et le serveur vérifie que l'identifiant renvoyé en fait bien partie.
- Les dates et montants extraits sont des **déclarations du client**, stockées comme propositions. Ils ne modifient ni solde ni statut.
- Chaque catégorie correspond à une action fixée dans le code [tableau §7.2]. L'IA ne choisit pas l'action.
- Sous le seuil de confiance, ou si la sortie ne respecte pas le schéma : revue humaine.

**Injection de prompt**
- Le contenu des emails, les noms de clients et les notes sont transmis comme données délimitées, jamais dans les instructions.
- Même si l'IA était trompée, elle ne peut produire qu'un JSON au format attendu ; le pire résultat possible est une mauvaise proposition, soumise à un humain.

### 4.8 Secrets

- Jetons OAuth chiffrés (AES-256-GCM) par l'application avant écriture ; la clé de chiffrement est dans les variables d'environnement du serveur, pas dans la base. Une copie de la base seule ne donne pas accès aux boîtes mail.
- Clés versionnées pour permettre la rotation.
- Aucune variable secrète avec le préfixe `NEXT_PUBLIC_` ; un test de build le vérifie.
- Journaux : emails masqués, corps de messages et jetons jamais écrits.

### 4.9 Structure du dépôt

Celle du §9 du cahier des charges, avec trois précisions :

```
src/app/(app)/o/[orgSlug]/...   écrans, tous sous l'organisation active
src/lib/money/                  type Money, analyse et mise en forme
src/lib/db/admin.ts             seul point d'accès à la clé d'administration
supabase/tests/                 tests d'isolation RLS
```

---

## 5. Risques de sécurité et de conformité

### 5.1 Sécurité

| # | Risque | Gravité | Mesure |
|---|--------|---------|--------|
| S1 | Fuite de données entre organisations | Critique | Trois barrières (§4.2), tests d'isolation par table, test bloquant si une table n'a pas de RLS |
| S2 | Usage incontrôlé de la clé d'administration | Critique | Module unique, règle de lint, `organizationId` obligatoire |
| S3 | Vol de jetons OAuth (accès à la boîte mail d'un client) | Critique | Chiffrement applicatif, table inaccessible aux utilisateurs, scopes minimaux, révocation à la déconnexion |
| S4 | Injection de prompt par un email entrant | Élevée | Agents sans outil, sortie par schéma, actions fixées par le code, validation humaine (§4.7) |
| S5 | Montant, date ou coordonnées bancaires inventés par l'IA | Élevée | Emplacements + substitution serveur + contrôle avant envoi |
| S6 | Relance envoyée en double, ou à une facture payée ou contestée | Élevée | Prise atomique, garde-fous revérifiés, pas de renvoi à l'aveugle (§4.6) |
| S7 | Relance envoyée au mauvais destinataire | Élevée | Validation des adresses, prévisualisation, approbation humaine, pas de rattachement automatique incertain |
| S8 | Élévation de privilèges (changement de rôle, dernier Owner) | Élevée | Changements de rôle via fonctions serveur uniquement, contraintes, audit |
| S9 | Webhook falsifié ou rejoué | Moyenne | Signature vérifiée sur le corps brut, déduplication |
| S10 | Fichier CSV malveillant | Moyenne | Limite de taille, contrôle du type, pas d'exécution ; à l'export, neutralisation des cellules commençant par `=`, `+`, `-`, `@` (injection de formules dans Excel) |
| S11 | XSS via le contenu d'un email affiché | Moyenne | Affichage en texte ou HTML assaini, images distantes bloquées, politique CSP |
| S12 | Contournement des quotas par appel direct | Moyenne | Vérification serveur dans les services, jamais dans l'interface |
| S13 | Données personnelles dans les journaux ou chez Sentry | Moyenne | Masquage à la source, filtrage avant envoi |
| S14 | Énumération de comptes, force brute | Moyenne | Limitation de débit, messages d'erreur neutres |

### 5.2 Conformité

Je ne suis pas juriste : les points ci-dessous sont à faire valider, comme le demande le cahier des charges [§12].

| # | Sujet | Ce qu'il faut savoir |
|---|-------|----------------------|
| C1 | **Validation Google pour Gmail** | La lecture des emails Gmail utilise des scopes « restreints ». Google exige une vérification de l'application et un audit de sécurité par un tiers (CASA), renouvelé chaque année. Cela prend des semaines et a un coût. En mode « test », l'application est limitée à 100 utilisateurs et les connexions expirent au bout de 7 jours. **À lancer dès la phase 2**, bien avant la phase 4. C'est le principal risque de calendrier. |
| C2 | **Validation Microsoft** | Vérification d'éditeur nécessaire pour éviter les écrans d'avertissement ; certains clients exigeront l'accord de leur administrateur. |
| C3 | **Rôles RGPD** | CashPilot est a priori sous-traitant pour les données de ses clients (factures, contacts, emails) et responsable de traitement pour les comptes utilisateurs. Un DPA est à fournir. |
| C4 | **Données de tiers** | Les emails contiennent des données de personnes (contacts des entreprises débitrices) qui n'ont aucun lien avec CashPilot. Minimisation, durées de conservation et procédure de purge sont nécessaires. |
| C5 | **Transferts hors UE** | OpenAI, Vercel, Supabase, Resend, Stripe, Sentry, Trigger.dev : registre des sous-traitants, régions de traitement, clauses contractuelles. Vérifier la non-utilisation des données pour l'entraînement des modèles. |
| C6 | **Analyse d'impact (AIPD)** | Probablement utile : traitement d'emails par IA à grande échelle. |
| C7 | **Recouvrement amiable** | En France, le recouvrement pour le compte d'autrui est une activité réglementée. CashPilot doit rester un **outil** : l'entreprise relance ses propres factures, depuis sa propre boîte mail, sous son nom. À confirmer par un avocat. |
| C8 | **Pénalités et indemnité forfaitaire** | Hors périmètre : aucun calcul ni mention générés par le produit [§3]. |
| C9 | **Règlement européen sur l'IA** | Informer les utilisateurs qu'un contenu est produit par IA ; le contrôle humain prévu va dans le bon sens. Qualification exacte à valider. |
| C10 | **Communication commerciale** | Ne jamais présenter le produit comme « conforme » ou « certifié » [§17]. |
| C11 | **Droit à l'effacement contre journal d'audit** | Le journal est en ajout seul ; il référence des identifiants et non des données personnelles en clair, pour rester compatible avec une suppression. |

---

## 6. Prochaine étape

1. Vous tranchez D1 à D5 (§2.1) et corrigez ce qui ne convient pas dans D6 à D17.
2. Je démarre la **phase 1 — Fondations**, en commençant par le schéma SQL et les tests d'isolation.

Comptes à créer de votre côté pour la phase 1 (gratuits à ce stade) : Supabase et Vercel.
Vous ne me transmettez aucune clé dans la conversation : elles iront dans un fichier `.env.local`
sur votre machine, jamais dans le dépôt.
