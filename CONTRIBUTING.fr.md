[English](CONTRIBUTING.md) · **Français**

# Contribuer à Atlas OS

Merci de vouloir aider. Atlas OS est une application Windows « local d'abord » (Electron + Next.js + PostgreSQL embarqué) : **aucune donnée ne quitte le PC de l'utilisateur**, et les contributions doivent le préserver.

## Avant de commencer

- Pour tout ce qui dépasse une petite correction, **ouvre d'abord une issue ou une discussion** afin de s'accorder sur l'approche avant que tu y passes du temps.
- **Règle de design :** l'interface suit la maquette de référence. N'ajoute pas de nouveau bouton, panneau ou style de ta propre initiative. La barre latérale contient exactement ses dix entrées.
- **Règle de confidentialité :** pas de télémétrie, pas de mesure d'audience, pas de nouvel appel réseau. La seule connexion de l'application est la vérification des mises à jour vers GitHub (voir [docs/DESKTOP.fr.md](docs/DESKTOP.fr.md)).

## Installer le projet

Prérequis : Node.js 22+ (voir `.nvmrc`).

```bash
git clone https://github.com/TheLion007/atlas-os.git
cd atlas-os
npm install
npm run dev            # http://127.0.0.1:3000
```

La base de développement est le dossier `data/` à côté du projet ; il est ignoré par git. Ne le commite jamais, ni une sauvegarde, ni un fichier `.env`.

## Proposer une modification

1. Fais un _fork_ du dépôt et crée une branche (`git checkout -b ma-modification`).
2. Fais ta modification, avec des tests quand c'est pertinent.
3. Lance **`npm run check`** : lint, types, tests et format doivent tous passer.
4. Ouvre une _pull request_ qui explique **ce qui change** et **pourquoi**. Des captures aident pour tout ce qui se voit.

Messages de commit : une courte ligne de résumé à l'impératif (« Corriger le début de semaine du calendrier »), puis des détails si besoin.

## Où sont les choses

Voir [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) pour les scripts et conventions, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les couches, et [docs/DESKTOP.fr.md](docs/DESKTOP.fr.md) pour l'application Windows. (Ces documents techniques sont en anglais.)

## Signaler un problème

Utilise le [formulaire d'issue](https://github.com/TheLion007/atlas-os/issues/new/choose). Indique ta version d'Atlas OS (Paramètres), ce que tu as fait, ce que tu attendais et ce qui s'est passé. **Ne joins jamais ta base de données ni des documents privés.** Pour un problème de sécurité, n'ouvre pas d'issue publique : contacte plutôt le mainteneur via GitHub.

## Licence

En contribuant, tu acceptes que ta contribution soit publiée sous [licence MIT](LICENSE).
