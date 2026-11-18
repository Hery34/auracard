# carnet-outbox-leads — installation

E-mail au propriétaire d'un profil pour chaque nouveau message de visiteur (événement `lead.created` de `carnet.outbox`) : fiche 0033, ADR 0006, ADR 0009, migration `20261118120000_create_leads_and_outbox.sql`.

## Fonctionnement
1. **Every minute** : toutes les minutes.
2. **Config** : trois champs saisis à l'import :
   - `supabaseUrl` : URL publique de Supabase ;
   - `fromAddress` : adresse d'expédition, sans nom affiché ;
   - `siteUrl` : URL publique du site, pour le lien vers `/tableau-de-bord/messages`.
3. **Claim outbox** : `POST /rest/v1/rpc/claim_outbox`, en-tête `Content-Profile: carnet`, corps `{ "p_limit": 20 }`. La fonction verrouille chaque événement renvoyé pendant 5 minutes et incrémente `attempts`. Un lot vide (réponse `[]`) ne produit aucun élément : les nœuds suivants ne s'exécutent pas et l'exécution se termine en succès, donc sans être enregistrée.
4. **Has events** : laisse passer les lignes qui ont un `id`.
5. **Build email** (nœud Code, un passage par événement, aucun module externe) :
   - destinataire : e-mail du propriétaire ;
   - `From` : `"<nom du visiteur> via AuraCard" <fromAddress>`, en clair et entre guillemets, avec `\` et `"` échappés. L'encodage RFC 2047 du nom accentué est laissé à nodemailer, qui produit un mot encodé hors guillemets : la RFC 2047 §5 interdit un mot encodé dans une chaîne entre guillemets ;
   - `Reply-To` : `lead_email` seul s'il s'agit d'une adresse unique valide, sinon vide (aucun `Reply-To`) ;
   - aucun retour à la ligne, caractère de contrôle, séparateur U+2028/U+2029 ni caractère bidi (U+202A à U+202E, U+2066 à U+2069) dans les en-têtes ;
   - corps en texte brut et en HTML simple, contenu du visiteur échappé en HTML ;
   - avertissement « Expéditeur non vérifié : ne communiquez aucune information sensible » dans le texte et le HTML ;
   - ligne `Référence : <id de l'événement>` à la fin du texte, pour retrouver un doublon éventuel.
6. **Send email** : SMTP Infomaniak, texte + HTML, sans mention « sent with n8n ». En cas d'erreur, l'élément part sur la sortie d'erreur au lieu d'interrompre l'exécution.
7. **Complete outbox** (succès) : `complete_outbox(p_id)`, l'événement passe `processed`.
8. **Fail outbox** (erreur d'envoi) : `fail_outbox(p_id, 'smtp_send_failed')`, avec un code fixe, jamais le texte de l'erreur SMTP (qui peut contenir des adresses). L'événement reste `pending` et sera repris après 5 minutes, ou passe `dead` à la 5ᵉ tentative.
9. **Next batch** : réduit le lot à un seul élément puis rappelle « Claim outbox ». Un lot peut être incomplet, car les événements écartés comptent dans `p_limit` : on boucle donc jusqu'à obtenir un lot vide. Les événements en échec restent verrouillés 5 minutes, ce qui garantit l'arrêt de la boucle.

« Complete outbox » et « Fail outbox » sont réessayés 3 fois (5 s d'intervalle). Les deux fonctions n'agissent que sur un événement `pending` : les rejouer ne change rien. « Claim outbox » n'est pas réessayé : en cas d'échec, l'exécution suivante (une minute plus tard) prend le relais.

## Limites connues
- **Doublon possible** (décision 4) : si n8n s'arrête entre l'envoi et l'acquittement, ou si un envoi dure plus de 5 minutes, l'e-mail est renvoyé à la reprise. Le nombre de doublons est borné par les 5 tentatives. La ligne `Référence` permet de reconnaître un doublon.
- **Acquittement interrompu** : si « Complete outbox » échoue encore après ses 3 essais (Supabase injoignable), l'exécution s'arrête en erreur. Les événements déjà envoyés restent `pending`, sont repris après 5 minutes et renvoyés. Les doublons sont bornés à 5 envois par événement.
- **Lot mixte** : si un même lot contient des succès et des échecs, « Next batch » est atteint deux fois et « Claim outbox » est appelé deux fois. Ce second appel n'est pas sans effet : il réserve et traite un lot de plus. Il ne crée pas de doublon, car `claim_outbox` ne renvoie jamais un événement verrouillé.
- **`fail_outbox` tardif** : n8n exécute d'abord la branche de succès, boucle comprise, avant la branche d'erreur. Dans un lot mixte, « Fail outbox » n'est donc appelé qu'après les lots suivants. Si cela prend plus de 5 minutes, l'événement en échec peut être repris entre-temps par une autre exécution ; `fail_outbox` s'applique alors à sa tentative la plus récente.
- **Lot entièrement écarté** : si tous les événements candidats d'un appel sont écartés (`processed` faute de lead, `dead` après 5 tentatives), `claim_outbox` renvoie un lot vide alors qu'il reste des événements `pending`. La boucle s'arrête ; ils partent à l'exécution de la minute suivante.
- **Erreur SMTP non transitoire** (adresse du propriétaire refusée, quota atteint) : l'événement est retenté jusqu'à 5 fois, puis passe `dead`.
- **Aucun workflow d'alerte** au MVP (décision 5) : les événements `dead` se suivent avec la requête ci-dessous.
- **Phase 5** : `claim_outbox` renvoie tous les types d'événements. Avant d'ajouter un second type (rappels, confirmations), filtrer `claim_outbox` par type, ou faire vérifier `type === 'lead.created'` par ce workflow ; sinon il enverrait un e-mail de message pour un autre événement.

## Installation
1. **Identifiant Supabase** : reprendre l'identifiant *Supabase API* `carnet Supabase service_role` créé pour `carnet-media-purge` (voir `carnet-media-purge.md`). S'il n'existe pas encore, le créer avec les mêmes règles :
   - *Host* : URL publique de Supabase ;
   - *Service Role Secret* : clé `service_role` ;
   - restreint au domaine de Supabase ;
   - jamais partagé avec les autres projets.
2. **Identifiant SMTP** : créer un identifiant de type *SMTP* nommé `Infomaniak SMTP carnet` :
   - *User* : adresse de la boîte d'expédition ;
   - *Password* : son mot de passe ;
   - *Host* : `mail.infomaniak.com` ;
   - *Port* : `465`, *SSL/TLS* activé.

   Ces valeurs ne vont que dans l'identifiant n8n, jamais dans le workflow.
3. **Import** : *Workflows → Import from File* → `carnet-outbox-leads.json`.
4. **Config** : remplacer les trois valeurs d'exemple :
   - `supabaseUrl` : URL réelle, sans `/` final ;
   - `fromAddress` : la boîte de l'identifiant SMTP, ou un alias autorisé par Infomaniak ;
   - `siteUrl` : URL publique du site, par exemple `https://auracard.fr`.

   Le workflow ne lit pas l'environnement : l'accès à l'environnement reste bloqué sur l'instance n8n.
5. **Rattachement** : vérifier que les trois nœuds HTTP utilisent `carnet Supabase service_role`, et « Send email » l'identifiant SMTP Infomaniak.
6. **Activation** : faire le test manuel ci-dessous, puis activer le workflow (il est exporté inactif).

## Domaine d'expédition (ADR 0009)
À faire dans la zone DNS Infomaniak, **avant le premier envoi**, pour le domaine de `fromAddress` :
- **SPF** : enregistrement TXT `v=spf1 include:spf.infomaniak.ch -all`, ou ajout de `include:spf.infomaniak.ch` à un SPF existant. Il ne doit y avoir qu'un seul enregistrement SPF.
- **DKIM** : activer la signature DKIM du domaine dans le Manager Infomaniak (*Service Mail → Domaine → DKIM*) et publier l'enregistrement TXT proposé.
- **DMARC** : enregistrement TXT `_dmarc` :
  - pour commencer : `v=DMARC1; p=none; rua=mailto:<adresse de rapports>` ;
  - après quelques semaines de rapports propres : `p=quarantine`.

Contrôle : un e-mail reçu doit afficher `spf=pass`, `dkim=pass` et `dmarc=pass` dans ses en-têtes `Authentication-Results`.

## Conservation des exécutions (décision 6)
Les exécutions n8n contiennent le nom, l'adresse et le message des visiteurs. Ces données ne doivent pas survivre à la purge des leads (12 mois).
- **Dans le workflow** :
  - `saveDataSuccessExecution: none` : les exécutions réussies ne sont pas enregistrées. C'est le cas normal, y compris quand un envoi échoue (l'échec passe par la sortie d'erreur) ;
  - `saveManualExecutions: false` ;
  - `saveExecutionProgress: false`.
- **Exécutions en erreur** (Supabase injoignable, par exemple) : elles restent enregistrées pour le diagnostic. Sur l'instance n8n, vérifier la purge automatique :
  - `EXECUTIONS_DATA_PRUNE=true` (valeur par défaut depuis n8n 1.0) ;
  - `EXECUTIONS_DATA_MAX_AGE=336` (en heures, soit 14 jours, valeur par défaut) ou moins.

  Ces variables concernent toute l'instance, partagée avec les autres projets.
- **RGPD** : les exécutions en erreur, qui peuvent contenir les données d'un visiteur, sont conservées 14 jours au plus. n8n (instance d’exécution des workflows) et Infomaniak (envoi SMTP) sont des sous-traitants ; la mention d'information doit les citer.
- Pour ne rien conserver du tout : dans *Workflow settings*, régler « Save failed production executions » sur *Do not save* (`saveDataErrorExecution: none`). Les erreurs ne se verront plus que dans `carnet.outbox`.

## Suivi des événements `dead`
Dans l'éditeur SQL de Supabase (rôle `postgres`) :

```sql
select id, type, profile_id, attempts, last_error, created_at, locked_at
  from carnet.outbox
 where status = 'dead'
 order by created_at desc;
```

Les événements `processed` et `dead` sont purgés après 30 jours (`carnet-purge-outbox`).

## Test manuel
1. Workflow importé, identifiants rattachés, « Config » rempli, workflow encore **inactif**.
2. Sur un profil de test publié dont le propriétaire a une boîte que vous consultez, envoyer 3 messages depuis le formulaire de contact de la page publique :
   - un nom accentué, et un message contenant `<b>test</b>` sur deux lignes ;
   - un nom contenant des guillemets, par exemple `Eve "test"` ;
   - un nom simple.
3. Vérifier les événements : `select id, status, attempts from carnet.outbox order by created_at desc limit 3;` doit donner 3 lignes `pending` avec `attempts = 0`. Noter les 3 `id`.
4. Dans n8n, lancer *Execute workflow*. Attendu :
   - « Send email » : 3 éléments sur la sortie de succès ;
   - « Complete outbox » exécuté pour chacun ;
   - un second passage de « Claim outbox » sans élément.
5. Vérifier chaque e-mail reçu :
   - expéditeur affiché « <nom> via AuraCard », lisible et non encodé, guillemets compris ;
   - en-tête `From` brut (*Afficher l'original* ou *Source du message*) : le nom accentué apparaît sous la forme `=?UTF-8?…?= <adresse>`, **sans guillemets autour du mot encodé** ; le nom ASCII apparaît entre guillemets ;
   - *Répondre* propose l'adresse du visiteur ;
   - `<b>test</b>` apparaît en texte et non en gras ;
   - avertissement « Expéditeur non vérifié » présent ;
   - le lien mène à `/tableau-de-bord/messages` ;
   - la ligne `Référence :` porte l'`id` de l'événement ;
   - aucune mention n8n ;
   - SPF, DKIM et DMARC à `pass`.
6. Relancer la requête du point 3 : chacun des 3 `id` doit être `processed` avec `attempts = 1`. Relancer *Execute workflow* : aucun nouvel e-mail, puisque le rejeu est sans effet.
7. Échec d'envoi : dupliquer temporairement l'identifiant SMTP avec un mauvais mot de passe, le rattacher à « Send email », envoyer un nouveau message, puis exécuter. Attendu :
   - « Fail outbox » exécuté ;
   - l'événement est `pending` avec `last_error = 'smtp_send_failed'` ;
   - une nouvelle exécution dans les 5 minutes ne le reprend pas.

   Remettre ensuite le bon identifiant : l'événement est envoyé à l'exécution qui suit les 5 minutes.
8. Activer le workflow. Supprimer l'identifiant SMTP de test.

## Règles
- Aucun secret dans le dépôt : ni clé, ni mot de passe, ni hôte SMTP, ni adresse réelle ; pas de `pinData` dans l'export.
- Ré-export après modification :
  - remettre les valeurs d'exemple dans « Config » ;
  - retirer `pinData` ;
  - vérifier avec `pnpm test:integration tests/integration/n8n-outbox-leads-workflow.test.ts`.
