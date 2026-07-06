# Duel avec l'ombre de Lucky Luke

Devant une webcam vous contrôlez l'ombre de Lucky Luke.
Dans un premier temps, essayez de la contrôler et d'attraper les revolvers.

Une fois prêt, **tapez des mains** au-dessus de votre tête pour déclencher le duel ...

Arriverez-vous à tirer plus vite que votre ombre ?

## Installation / démarrage

### Prérequis

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)

### Installer les dépendances

```bash
pnpm install
```

### Mode développement

Démarre le serveur Vite avec rechargement à chaud sur [http://localhost:3000/lucky-luke-duel/](http://localhost:3000/lucky-luke-duel/) :

```bash
pnpm dev
```

### Mode production locale (preview)

Build l'application dans le dossier `web/`, puis lance un serveur de preview sur [http://localhost:4173/lucky-luke-duel/](http://localhost:4173/lucky-luke-duel/) :

```bash
pnpm build:web
pnpm preview
```

### Démarrage rapide (Windows)

Un script `start.bat` est disponible à la racine du projet pour lancer directement le mode développement :

```bat
start.bat
```

## Crédits / ressources utilisées

L'application est basée sur la librairie de [Bandinopla](https://bandinopla.github.io/) permettant de mapper un modèle 3D dans une scène ThreeJs au squelette détecté par les modèles d'IA [mediapipe](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker?hl=fr)

Les modèles de détection sont téléchargés en local dans le dossier `models` pour faire fonctionner l'application. Les liens sont disponibles sur la page mediapipe ci-dessus.
Pour utiliser les modèles en ligne, modifier le fichier `PoseTrakcer.ts`, l.13, vers `...PoseLandmarker.createFromOptions...`

```js
await setupTracker({
  modelPaths: {
    vision: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
    pose: "/models/pose_landmarker_lite.task",
    hand: "/models/hand_landmarker.task",
    face: "/models/face_landmarker.task",
  },
});
```

Le [modèle 3D de Lucky Luke](https://sketchfab.com/3d-models/lucky-luke-9bd7050a53ad4d82ac3a23709d0b4b24) a été initialement créé par [CzernO](https://sketchfab.com/czernobog), téléchargeable sur Sketchfab avec la licence **CC Attribution** ([infos](http://creativecommons.org/licenses/by/4.0/)).

## Modifications

Le modèle 3D a été énormément simplifié et un rig a été ajouté pour contrôler la pose. Différentes animations ont été intégrées grace au site [Mesh2Motion](https://mesh2motion.org/) L'ensemble est travaillé avec [Blender](https://www.blender.org/).

Pour des raisons de performances, seul le modèle de "body" est utilisé. Les mains et visages ne sont pas trackées.

## Installer et lancer la démo

```bash
npm install
```

```bash
npm run dev
```

## License

MIT
