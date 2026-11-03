# Atelier d’idées

Une application de collecte pour ateliers. L’animateur pose une question et partage un QR code. Chaque participant choisit un prénom ou un pseudo puis propose ses idées depuis son téléphone. L’animateur peut copier toute la liste ou la télécharger en CSV.

Front HTML, CSS et JavaScript. Les listes d’administration utilisent Vue 3.5.18, comme QuizLive. Le formulaire participant utilise uniquement JavaScript natif. Backend PHP 8.4 sans framework, Apache et SQLite. Les scripts, le générateur de QR codes et les styles sont embarqués dans l’image. L’application en fonctionnement ne contacte aucun service externe.

## Déployer sur RKE2

1. Décompresse l’archive et mets le **contenu** du dossier `atelier-idees/` à la racine de ton dépôt GitHub. Inclus le dossier `.github/`. Pousse le commit sur la branche par défaut.
2. Dans **Actions**, ouvre **Tester et publier Atelier d’idées**. Après les tests, le workflow publie `ghcr.io/<propriétaire>/<dépôt>` pour Linux AMD64 et ARM64. Télécharge l’artefact **manifeste-rke2** et décompresse-le. Il contient `atelier-rke2.yaml`, déjà renseigné avec le digest de l’image de cette exécution.
3. Depuis un poste où `kubectl` pointe sur ton cluster et le namespace voulu, lance ces deux commandes.

~~~bash
kubectl apply -f atelier-rke2.yaml
kubectl rollout status deployment/atelier-idees
~~~

Le manifeste crée un **Deployment à un réplica**, un **Service ClusterIP** et un **PVC de 1 Gio**. Il utilise la StorageClass par défaut du cluster. Vérifie-la avec `kubectl get storageclass`. S’il n’y en a pas, renseigne `storageClassName` dans le PVC ou affecte-lui un volume déjà provisionné. Choisis un stockage persistant adapté à SQLite, par exemple un volume bloc formaté ext4 ou XFS. Évite un partage de fichiers NFS/SMB pour ce fichier de base.

**Premier essai depuis ton poste**

~~~bash
kubectl port-forward service/atelier-idees 8080:80
~~~

Ouvre [la page d’administration locale](http://localhost:8080/admin.html). La clé d’administration initiale est **`atelier-idees-admin-2027`**.

**Essai sur téléphone, sans DNS**

Si le téléphone et ton poste se trouvent sur le même réseau interne, tu peux lier temporairement le port à l’adresse LAN de ton poste. Par exemple, pour un poste à l’adresse `192.168.1.42`, lance la commande ci-dessous puis ouvre l’administration sur `http://192.168.1.42:8080/admin.html`. Laisse la commande ouverte pendant l’essai.

~~~bash
kubectl port-forward --address 192.168.1.42 service/atelier-idees 8080:80
~~~

**Accès permanent des participants via un Ingress**

Dans `k8s/ingress.example.yaml`, remplace `idees.exemple.fr` par le nom DNS interne qui pointe vers ton Ingress. Utilise la classe Ingress de ton cluster (`kubectl get ingressclass`) et son certificat si tu termines TLS à cet endroit. Applique le fichier dans le même namespace.

~~~bash
kubectl apply -f k8s/ingress.example.yaml
~~~

**Ouvre ensuite l’administration depuis ce nom DNS** avant d’afficher le QR code. Celui-ci reprend l’origine visible dans la barre d’adresse. Un QR généré depuis `localhost` renverrait chaque téléphone vers lui-même. Les participants doivent pouvoir atteindre le nom choisi depuis le Wi-Fi ou le VPN de l’atelier.

**Si le package GHCR est privé**

Le cluster doit disposer d’un accès en lecture au package. Réutilise l’accès registre déjà configuré sur RKE2. Si tu utilises un `imagePullSecret`, ajoute-le dans `spec.template.spec` du Deployment avant d’appliquer le manifeste, dans le même namespace que le Secret.

~~~yaml
imagePullSecrets:
  - name: ghcr-pull
~~~

Si le Secret doit être créé, utilise des identifiants autorisés à lire le package. Renseigne les deux variables dans ton terminal puis lance cette commande dans le namespace de l’application.

~~~bash
kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" \
  --docker-password="$GHCR_READ_TOKEN"
~~~

**Mises à jour**

Après une nouvelle publication, applique le nouveau `atelier-rke2.yaml`. Le changement de digest déclenche le remplacement du pod. La stratégie `Recreate` libère le volume avant le démarrage du nouveau pod et occasionne une courte interruption. Conserve le PVC pour retrouver toutes les sessions. Pour une sauvegarde complète, utilise un snapshot du volume après arrêt du pod ou une sauvegarde SQLite cohérente.

Tu peux aussi déployer directement `k8s/atelier.yaml` depuis les sources en remplaçant son unique référence d’image par ton image GHCR avec un tag de version ou un digest.

## Animer un atelier

1. Ouvre `/admin.html`, saisis la clé d’administration et choisis **Nouvelle session**. La question proposée est « Qu’est-ce que vous voulez livrer en juin 2027 ? ».
2. Valide la question. L’application génère un code de six caractères et un QR code. Clique sur le QR pour l’agrandir en projection, ou sur **Copier le lien** pour partager l’invitation.
3. Le participant scanne le QR, suit le lien ou ouvre `/` et saisit le code. Il choisit un pseudo puis utilise **Envoyer mon idée** pour chaque contribution. Le pseudo reste dans son onglet après validation. Les idées enregistrées ne contiennent ni prénom ni identifiant de participant.
4. Dans l’administration, **Actualiser** affiche les nouvelles contributions, dans l’ordre de réception. **Tout copier** relit la liste sur le serveur et copie uniquement les textes, une idée par ligne. Les retours à la ligne à l’intérieur d’une idée sont remplacés par des espaces.
5. **Exporter en CSV** télécharge toutes les idées de la session dans une colonne `Idée`, en UTF-8 avec BOM, avec gestion des accents, des guillemets et du séparateur français. Une apostrophe protège les cellules susceptibles d’être interprétées comme des formules par un tableur. La copie en texte brut conserve les caractères d’origine.
6. **Modifier la question** met la consigne à jour. Les contributions déjà reçues sont conservées. Si un participant envoie une idée alors que sa question a changé, le formulaire affiche la nouvelle question et conserve son brouillon pour confirmation.

L’atelier fonctionne sans WebSocket. Le brouillon et le jeton de participation sont conservés dans l’onglet pendant la session. Une nouvelle tentative après une réponse réseau perdue réutilise le même identifiant d’envoi et évite un doublon.

## Essayer avec Docker

Lance ces commandes à la racine du projet.

~~~bash
docker build -t atelier-idees:local .
docker volume create atelier-idees-data
docker run -d --name atelier-idees \
  -p 8080:8080 -v atelier-idees-data:/data \
  atelier-idees:local
~~~

[Participer en local](http://localhost:8080/) · [Administrer les sessions](http://localhost:8080/admin.html)

Pour essayer sans Docker, PHP 8.3 ou 8.4 avec `pdo_sqlite` suffit.

~~~bash
php -S 127.0.0.1:8080 -t public
~~~

Le mode local crée `var/atelier.sqlite`. Dans le conteneur, la base est placée dans `/data/atelier.sqlite`. Le processus s’exécute avec l’UID/GID 33. Le manifeste monte `/tmp` en écriture pour Apache et laisse la racine du conteneur en lecture seule.

## Clés et publication

| Accès | Valeur initiale | Emplacement |
| --- | --- | --- |
| Front vers API | `atelier-idees-web-v1` | `APP_KEY` dans `app/config.php` et `appKey` dans `public/assets/common.js` |
| Administration | `atelier-idees-admin-2027` | `ADMIN_KEY` dans `app/config.php` |

La clé commune est incluse dans le JavaScript. Les lectures de la liste et l’export exigent en plus la clé d’administration. Un participant reçoit un jeton aléatoire valable uniquement pour sa session. Aucun fichier `.env` ni Secret Kubernetes applicatif à créer.

Le workflow utilise le `GITHUB_TOKEN` fourni par GitHub, avec `contents: read` et `packages: write` pour la publication. La branche par défaut publie `latest` et un tag `sha-…`. Un tag Git tel que `v1.0.0` publie la version correspondante. Les pull requests exécutent les tests. [Documentation GitHub sur GHCR](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)

## Vérifier l’image

Sur une machine équipée de Docker, Python 3, Bash et curl, lance le test suivant.

~~~bash
docker build -t atelier-idees:test .
bash tests/check-image.sh atelier-idees:test
~~~

Le script démarre un conteneur de test avec une racine en lecture seule et un volume dédié. Il vérifie notamment l’isolation des sessions, la modification de la question, les envois de 50 participants concurrents, la déduplication et le CSV. Il recrée ensuite le conteneur avec le même volume et vérifie toutes les idées avant de nettoyer ses ressources de test.

Le générateur embarqué est **qrcode-generator 1.4.4** de Kazuhiko Arase. Sa licence MIT et celle de Vue accompagnent les scripts dans `public/assets/vendor/`.
