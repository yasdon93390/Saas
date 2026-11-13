# Phase 1 — Fondations

## Ce qui est livré

| Domaine | Détail |
|---------|--------|
| Comptes | Inscription, confirmation par email, connexion, déconnexion, mot de passe oublié |
| Organisations | Création, liste, changement d'organisation ; l'organisation active est dans l'adresse (`/o/acme`) |
| Membres | Invitation par adresse email, acceptation, changement de rôle, désactivation, annulation d'invitation |
| Rôles | Propriétaire, Administrateur, Finance, Collaborateur, Lecture seule |
| Sécurité | RLS sur toutes les tables, aucun droit d'écriture direct, rôle anonyme sans aucun accès |
| Audit | Journal en ajout seul, consultable par Propriétaire et Administrateur |
| Interface | Barre latérale, en-tête, états vides, pages 403 et 404, formulaires accessibles |
| Outillage | Lint, typage, tests, intégration continue GitHub Actions |

## Où se trouve quoi

```
supabase/migrations/     schéma SQL : tables, RLS, fonctions métier
supabase/config.toml     réglages de la pile Supabase locale
src/proxy.ts             renouvelle la session, renvoie les non-connectés vers /login
src/lib/auth/context.ts  qui est connecté, dans quelle organisation, avec quel droit
src/lib/permissions/     matrice des rôles (source unique côté application)
src/lib/validation/      contrôle de toutes les données reçues du navigateur
src/lib/db/errors.ts     traduction des erreurs SQL en messages clairs
src/app/(auth)/          connexion, inscription, mot de passe oublié
src/app/organizations/   liste, création, invitations en attente
src/app/o/[orgSlug]/     écrans d'une organisation
tests/unit/              permissions et validation
tests/integration/       isolation et règles, contre un vrai PostgreSQL
tests/e2e/               parcours complets dans un navigateur
```

## Comment une action est protégée

Exemple : Alice invite Bob.

1. **Le serveur** vérifie qu'Alice est connectée, membre active de l'organisation, et que son rôle
   autorise `members.manage` (`authorizeAction`).
2. **Le serveur** valide l'adresse et le rôle reçus (`inviteMemberSchema`).
3. **La base** revérifie tout dans la fonction `invite_member` : rôle d'Alice, interdiction pour un
   Administrateur de nommer un Propriétaire. Elle écrit l'invitation et la ligne d'audit dans la
   même transaction : il ne peut pas y avoir l'une sans l'autre.

Si l'étape 1 était oubliée par erreur dans une future page, l'étape 3 refuserait quand même.

## Comment fonctionne une invitation

Il n'y a pas de lien secret à transmettre. L'invitation est attachée à une adresse email. Quand une
personne se connecte avec cette adresse **vérifiée**, elle voit l'invitation et peut la rejoindre.
Quelqu'un qui ne contrôle pas la boîte mail invitée ne peut ni voir ni accepter l'invitation.

## Tests exécutés

| Suite | Nombre | Ce qu'elle prouve |
|-------|-------:|-------------------|
| Unitaires | 84 | Chaque case de la matrice rôle × permission ; validation ; redirections sûres |
| Base de données | 29 | Isolation entre organisations, règles de rôles, dernier propriétaire, invitations, audit non modifiable |
| Bout en bout | 9 | Inscription, confirmation par email, création, invitation, lecture seule, 403, 404 entre organisations, désactivation, mot de passe oublié |

Les tests de base de données tournent sur un PostgreSQL 16 nu avec une imitation minimale de
Supabase (`supabase/tests/supabase-shim.sql`). Les tests de bout en bout tournent sur la vraie pile
Supabase locale, où la migration s'applique telle quelle.

## Critères d'acceptation de la phase 1

| Critère | État | Preuve |
|---------|------|--------|
| Un utilisateur de A ne peut rien lire ni modifier chez B | Vérifié | `tests/integration` (« isolation entre organisations »), `tests/e2e` (Carole / Acme) |
| Toute table a la RLS ; un test échoue sinon | Vérifié | « garde-fous structurels » |
| Lecture seule → refus sur toute écriture | Vérifié | Refus en base (42501) et page 403 dans le navigateur |
| Invitations et changements de rôle dans l'audit | Vérifié | `tests/integration`, `tests/e2e` |
| Connexions dans l'audit | **Partiel** | Voir « Limites » |
| Le dernier Propriétaire ne peut être retiré ni rétrogradé | Vérifié | « dernier Owner », y compris avec la clé d'administration |

## Limites connues et reste à faire

- **Rien n'est déployé.** Tout a été testé en local uniquement. Il n'existe ni projet Supabase en
  ligne, ni hébergement Vercel.
- **L'intégration continue n'a jamais tourné** : le fichier `.github/workflows/ci.yml` est écrit mais
  n'a pas encore été exécuté par GitHub.
- **Aucun email d'invitation n'est envoyé.** La personne invitée doit être prévenue par vous et créer
  son compte avec la bonne adresse. L'envoi d'emails système (Resend) arrive en phase 3.
- **Les connexions ne sont pas dans le journal d'audit de l'organisation.** Une connexion n'appartient
  à aucune organisation ; elle est enregistrée dans le journal propre à Supabase Auth.
- **shadcn/ui n'est pas installé.** Les quelques composants (bouton, carte, badge, champ) sont écrits
  à la main dans le même esprit. À remplacer quand les écrans de données arriveront en phase 2.
- **Pas de modification ni de suppression d'organisation**, pas de changement du nom affiché dans
  l'interface (la base l'autorise déjà).
- **Limitation de débit** : seule celle de Supabase Auth s'applique. Limitation applicative et
  politique CSP prévues en phase 6.
- **Mot de passe compromis** : la vérification contre les fuites connues est une option de Supabase
  à activer sur le projet en ligne.

## Réglages à reproduire sur le projet Supabase en ligne

Le fichier `supabase/config.toml` ne règle que la pile locale. Sur le projet en ligne, dans
Authentication :

1. « Confirm email » activé.
2. Longueur minimale du mot de passe : 12.
3. « Site URL » : l'adresse publique de l'application.
4. « Redirect URLs » : `https://votre-domaine/auth/callback`.
5. Région du projet : Union européenne.
