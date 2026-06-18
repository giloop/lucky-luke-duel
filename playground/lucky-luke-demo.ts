import {
    AnimationAction,
    AnimationClip,
    AnimationMixer,
    LoopOnce,
    AudioLoader,
    AxesHelper,
    BufferAttribute,
    BufferGeometry,
    Color,
    LineBasicMaterial,
    LineSegments,
    DirectionalLight,
    DirectionalLightHelper,
    Material,
    Mesh,
    MeshLambertMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    BoxGeometry,
    Scene,
    SkinnedMesh,
    Texture,
    TextureLoader,
    Vector3,
    WebGPURenderer,
    LoopPingPong,
    ShadowMaterial,
    Quaternion,
    Matrix4,
    CylinderGeometry,
} from "three/webgpu";

import { GLTFLoader, OrbitControls } from "three/examples/jsm/Addons.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CSG } from "three-csg-ts";
import { Inspector } from "three/examples/jsm/inspector/Inspector.js";
import { DemoHandler } from "./demo-type";
import { RecordableBindingHandler, TrackerHandler } from "lucky-luke-duel";
import { ShaderLib } from "three";

const DEFAULT_MODEL = import.meta.env.BASE_URL +  "Lucky-Luke-shoot.glb"; // "Lucky-Luke-simplified.glb";
const X_POSE_ROTATION = -10; // degrees, applied around hips local X axis
const DEBUG_MODE = true;
const GUN_GRAB_DISTANCE = 0.075; // distance threshold for detecting gun grab in duel mode (in normalized landmark space)
const WRIST_ABOVE_ELBOW_DISTANCE = 0.07; // distance threshold for detecting wrist above elbow in duel mode (in normalized landmark space)
const ARM_X_TOLERANCE = 0.07; // Step 2 guard: wrist must be this much closer to camera than elbow (normalized z) to count as arm pointing toward camera
const USE_WEBCAM_BY_DEFAULT = true;
const HEAD_ROTATION_OFFSET_X = 45; // degrees, extra rotation applied to the head bone around its local X axis

export const luckyLukeDemo: DemoHandler = {
    name: "lucky-luke-demo",
    trackerConfig: {
        displayScale: 1.0,
        ignoreFace: true,
        ignoreHands: true,
        smoothLandmarks: true,
        headRotationOffsetX: HEAD_ROTATION_OFFSET_X,
        debugVideo: import.meta.env.BASE_URL + "Lucky-luke.mp4"
    },
    setup: (
        renderer: WebGPURenderer,
        camera: PerspectiveCamera,
        scene: Scene,
        tracker: TrackerHandler,
    ) => {

        // — Scene setup —
        scene.background = new Color(0xffffff);
        renderer.shadowMap.enabled = true;
        //renderer.shadowMap.type = PCFSoftShadowMap;

        const axesHelper = new AxesHelper(1);
        scene.add(axesHelper);

        const ctrl = new OrbitControls(camera, renderer.domElement);
        ctrl.dampingFactor = 0.2;
        ctrl.enableDamping = true;

        camera.position.set(0, 0.9, 0.55);
        camera.lookAt(0, 0.93, 3.0);
        ctrl.target.set(0,  0.93, 3);
        ctrl.update();

        // - Light directionnal - 

        const dirLight = new DirectionalLight( 0xffffff, 2.5 );
        dirLight.position.set( 0, 0.35, -3 );   // behind character, elevated
        dirLight.target.position.set( 0, 0, 3 ); // aimed at the wall
        
        dirLight.castShadow = true;
        
        dirLight.shadow.mapSize.width = 4096;
        dirLight.shadow.mapSize.height = 4096;
        dirLight.shadow.intensity = 1;

        scene.add( dirLight );
        scene.add( dirLight.target );

        const dirLightHelper = new DirectionalLightHelper( dirLight, 10 );
        scene.add( dirLightHelper );
        
        // Floor plane

        const floorMat = new ShadowMaterial({ color: 0x000000, fog: false });
        floorMat.opacity = 0.75;
		const floor = new Mesh( new PlaneGeometry( 10, 10 ), floorMat ); 
		floor.rotation.x = - Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Palissade
        const wallTexture = new TextureLoader().load("palissade.jpg");
        const wallMaterial = new MeshLambertMaterial( { color: 0xffffff, map: wallTexture } );
        const wallHeight = 3;
        const wallWidth = 5;	
        const wall = new Mesh( new BoxGeometry( wallWidth, wallHeight, 0.01 ), wallMaterial );
        wall.rotation.y = Math.PI;
        wall.position.z = 2.5;
        wall.position.y += 0.5 * wallHeight;
        wall.receiveShadow = true;
        scene.add( wall );

        // Bullet hole — used as CSG brush; hidden by default
        const trouDeBalle = new CylinderGeometry(0.015, 0.015, 0.5, 32);
        trouDeBalle.rotateX(Math.PI / 2);
        const trouMesh = new Mesh(trouDeBalle, wallMaterial);
        trouMesh.position.set(0, 0.9, 2.5);
        trouMesh.visible = false;
        scene.add(trouMesh);

        // Precompute wall with bullet hole via CSG subtraction
        wall.updateMatrix();
        trouMesh.updateMatrix();
        const wallWithHole = CSG.subtract(wall, trouMesh);
        wallWithHole.material = wallMaterial;
        wallWithHole.receiveShadow = true;
        wallWithHole.visible = false;
        scene.add(wallWithHole);

        function showBulletHole() {
            wall.visible = false;
            wallWithHole.visible = true;
        }
        function hideBulletHole() {
            wallWithHole.visible = false;
            wall.visible = true;
        }

        // — Inspector panels —

        const inspector = new Inspector();
        renderer.inspector = inspector;
        inspector.init();
        if (USE_WEBCAM_BY_DEFAULT) {
            tracker.setVideoFromWebcam(false).catch((err) => {
                alert("Failed to access camera. Please allow camera access and try again. Err: " + err);
            });
        }

        const applyDebugMode = (on: boolean) => {
            (inspector.domElement as HTMLElement).style.display = on ? '' : 'none';
            (tracker.domElement as HTMLElement).style.display = on ? '' : 'none';
            axesHelper.visible = on;
            dirLightHelper.visible = on;
        };

        // — Loading overlay —
        const loadingOverlay = document.getElementById('loading-overlay')!;
        const progressFill = document.getElementById('loading-fill') as HTMLElement;
        const startBtn = document.getElementById('start-btn') as HTMLElement;

        const TOTAL_ASSETS = 3; // animations.glb + Lucky-Luke-shoot.glb 4 + Gunshot.mp3 + model
        let loadedCount = 0;
        const onAssetLoaded = () => {
            loadedCount++;
            progressFill.style.width = `${(loadedCount / TOTAL_ASSETS) * 100}%`;
            if (loadedCount < TOTAL_ASSETS) return;
            document.getElementById('loading-track')!.style.display = 'none';
            startBtn.style.display = 'block';
            startBtn.addEventListener('click', () => loadingOverlay.remove(), { once: true });
        };

        // — Production mode checkbox —

        const prodCheckbox = document.getElementById('prod-checkbox') as HTMLInputElement;
        prodCheckbox.checked = DEBUG_MODE;
        prodCheckbox.addEventListener('change', () => applyDebugMode(prodCheckbox.checked));
        applyDebugMode(DEBUG_MODE);

        const actions = {
            inputWebcam: () => {
                tracker.setVideoFromWebcam(false).catch((err) => {
                    alert("Failed to access camera. Please allow camera access and try again. Err: " + err);
                });
            },
            inputFile: () => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "video/*";
                input.onchange = () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    tracker.setVideoFromSource(file);
                };
                input.click();
            },
            loadModel: () => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".glb";
                input.onchange = () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    new GLTFLoader().load(URL.createObjectURL(file), setActiveRig);
                };
                input.click();
            },
        };

        const videoSourcePanel = inspector.createParameters("Video source");
        videoSourcePanel.add(actions, "inputWebcam").name("Webcam");
        videoSourcePanel.add(actions, "inputFile").name("Video File");

        if (tracker.poseTracker) {
            tracker.poseTracker.root.rotation.x = X_POSE_ROTATION * Math.PI / 180;
        }

        const poseSettings = inspector.createParameters("Pose settings");
        poseSettings
            .add({ ignoreLegs: false }, "ignoreLegs")
            .name("Ignore legs")
            .onChange((v: boolean) => {
                if (tracker.poseTracker) tracker.poseTracker.ignoreLegs = v;
            });

        let debugBonesEnabled = false;

        const POSE_PAIRS: [string, string][] = [
            ["hips", "torso"], ["torso", "neck"], ["neck", "head"],
            ["neck", "leftArm"],   ["leftArm",  "leftElbow"],  ["leftElbow",  "leftWrist"],
            ["neck", "rightArm"],  ["rightArm", "rightElbow"], ["rightElbow", "rightWrist"],
            ["hips", "leftLeg"],   ["leftLeg",  "leftKnee"],   ["leftKnee",   "leftFoot"],
            ["hips", "rightLeg"],  ["rightLeg", "rightKnee"],  ["rightKnee",  "rightFoot"],
        ];
        // Green = worldLandmarks (3D metres, body-centred)
        const skeletonBuf = new Float32Array(POSE_PAIRS.length * 6);
        const skeletonGeo = new BufferGeometry();
        skeletonGeo.setAttribute("position", new BufferAttribute(skeletonBuf, 3));
        const skeletonLines = new LineSegments(
            skeletonGeo,
            new LineBasicMaterial({ color: 0x00ff00, depthTest: false }),
        );
        skeletonLines.position.set(0, 0.87, 0);
        skeletonLines.visible = false;
        scene.add(skeletonLines);

        // Red = landmarks (normalised screen-space: x/y in [0,1], z = depth)
        const skeletonNormBuf = new Float32Array(POSE_PAIRS.length * 6);
        const skeletonNormGeo = new BufferGeometry();
        skeletonNormGeo.setAttribute("position", new BufferAttribute(skeletonNormBuf, 3));
        const skeletonNormLines = new LineSegments(
            skeletonNormGeo,
            new LineBasicMaterial({ color: 0xff0000, depthTest: false }),
        );
        skeletonNormLines.position.set(-1, 1.4, -0.5);
        skeletonNormLines.rotation.set(-30 * Math.PI / 180, 0, 0);
        skeletonNormLines.visible = false;
        scene.add(skeletonNormLines);

        poseSettings.add({
            logDetection: () => {
                if (tracker.poseTracker?.detected) {
                    console.log(tracker.poseTracker.lastResult);
                    console.log("Hips center world position:", tracker.poseTracker.getMarkWorldPosition("hips"));
                    console.log("Hips center landmark position:", tracker.poseTracker.getMarkPosition("hips"));
                    console.log("Torso center world position:", tracker.poseTracker.getMarkWorldPosition("torso"));
                    console.log("Torso center landmark position:", tracker.poseTracker.getMarkPosition("torso"));
                } else {
                    console.log("No detection");
                }
            }
        }, "logDetection").name("Log detection");

        const debugAxesHelpers: AxesHelper[] = [];
        poseSettings
            .add({ debugBones: false }, "debugBones")
            .name("Debug bones")
            .onChange((v: boolean) => {
                debugBonesEnabled = v;
                skeletonLines.visible = v;
                skeletonNormLines.visible = v;
                debugAxesHelpers.forEach((h) => (h.visible = v));
            });

        let modelRoot: Object3D | undefined;
        const shadowOpt = { castShadow: true };

        const modelPanel = inspector.createParameters("Model");
        modelPanel.add(actions, "loadModel").name("Load model (.glb)");
        // modelPanel.add(shadowOpt, "castShadow").name("Cast shadow").onChange((v: boolean) => {
        //     modelRoot?.traverse((child: Object3D) => {
        //         if (child instanceof Mesh) child.castShadow = v;
        //     });
        // });
        modelPanel.add({
            logCamera: () => {
                console.log("Camera position:", camera.position.toArray().map(n => +n.toFixed(2)));
                console.log("Camera lookAt (target):", ctrl.target.toArray().map(n => +n.toFixed(2)));
                console.log("Camera look direction:", camera.getWorldDirection(new Vector3()).toArray().map(n => +n.toFixed(2)));
                console.log("Camera rotation (deg):", [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(r => +(r * 180 / Math.PI).toFixed(1)));
            }
        }, "logCamera").name("Log camera");
        modelPanel
            .add({ axisHelpers: true }, "axisHelpers")
            .name("Axis helpers")
            .onChange((v: boolean) => {
                axesHelper.visible = v;
                dirLightHelper.visible = v;
            });

        // — Animations —

        let mixer: AnimationMixer | undefined;
        let clips: AnimationClip[] = [];
        let currentAction: AnimationAction | undefined;
        let animationPlaying = false;
        const animState = { clip: "" };
        let clipsPlaylist: string[] = [];
        const excludedClipsFromPlaylist = ['Jump 2', 'duel-idle', 'Falling Back Death', 'Getting Up'];

        let luckyShootClips: AnimationClip[] = [];
        // new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "Lucky-Luke-shoot.glb")
        //     .then((gltf) => { luckyShootClips.push(...gltf.animations); })
        //     .catch((err) => console.warn("Could not load Lucky-Luke-shoot.glb:", err))
        //     .finally(onAssetLoaded);

        const animPanel = inspector.createParameters("Animations");

        new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "animations.glb")
            .then((gltf) => {
                clips.push(...gltf.animations);
                if (gltf.animations.length === 0) return;
                animState.clip = gltf.animations[0].name;
                animPanel.add(animState, "clip", gltf.animations.map((c) => c.name)).name("Animation");
                animPanel.add({ toggle: toggleAnimation }, "toggle").name("Play / Stop");
                clipsPlaylist = [... gltf.animations.map((c) => c.name)];
                clipsPlaylist = clipsPlaylist.filter((clip) => !excludedClipsFromPlaylist.includes(clip));
            })
            .catch((err) => console.warn("Could not load animations.glb:", err))
            .finally(onAssetLoaded);
        

        function shufflePlaylist() {
            clipsPlaylist = clipsPlaylist.map(value => ({ value, sort: Math.random() }))
                                         .sort((a, b) => a.sort - b.sort)
                                         .map(({ value }) => value);
        }

        // — Audio —

        let audioCtx: AudioContext | undefined;

        let gunShotBuffer: AudioBuffer | undefined;
        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "Gunshot.mp3")
            .then((buf) => { gunShotBuffer = buf; })
            .catch((err) => console.warn("Could not load Gunshot.mp3:", err))
            .finally(onAssetLoaded);

        function playOneShot(buf: AudioBuffer | undefined) {
            if (!buf) return;
            if (!audioCtx) audioCtx = new AudioContext();
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(audioCtx.destination);
            src.start(0);
        }

        // — Duel state —
        let duelMode = false; // true:Duel, false: Détection normale de l'ombre & animation random si pas détecté
        let duelCountdown = false; // true: décompte en cours, false sinon
        let duelGunTriggered = false; // true: le joueur a tiré pendant le duel après le décompte
        let duelLayIdlePlaying = false; // true: la transition "Lay to Idle" est en cours de lecture après le tir du duel, avant de revenir à la détection normale
        let luckyWinPlaying = false;   // true: Lucky's shoot animation is running (player hasn't drawn yet)
        let luckyWins = false;
        let luckyRigAction: AnimationAction | undefined;
        let luckyGunAction: AnimationAction | undefined;
        let luckyRigBackAction: AnimationAction | undefined;
        let luckyGunBackAction: AnimationAction | undefined;
        let victoryAction: AnimationAction | undefined;

        const duelCountdownEl = document.getElementById('duel-countdown') as HTMLElement;
        const duelCountEl = document.getElementById('duel-count') as HTMLElement;

        function startDuel() {
            console.log("startDuel", { duelMode, duelCountdown, mixer });

            if (duelMode || duelCountdown || !mixer) return; // ignore if already in duel mode, or if countdown is in progress, or if mixer is not ready
            duelMode = true;
            duelShootDetected = false;
            duelGunGrabbedL = false;
            duelGunGrabbedR = false;
            duelCountdown = true;
            duelGunTriggered = false;
            luckyWins = false;

            const duelClip = clips.find(c => c.name === 'duel-idle');
            if (!duelClip) {
                console.warn("Could not find duel clip 'duel-idle' in", clips.map(c => c.name));
                duelCountdown = false;
                return; }

            // Start duel animation and countdown — stop all to clear any ongoing crossfade
            mixer.stopAllAction();
            currentAction = mixer.clipAction(duelClip);
            currentAction.setLoop(LoopPingPong, 5);
            currentAction.reset().fadeIn(IDLE_CROSSFADE_DURATION).play();
            animationPlaying = true;

            let count = 5;
            duelCountEl.textContent = String(count);
            duelCountdownEl.style.display = 'flex';
            
            const tick = setInterval(() => {
                count--;
                if (count > 0) {
                    duelCountEl.textContent = String(count);
                } else {
                    clearInterval(tick);
                    duelCountEl.textContent = 'Tire !';
                    console.log("Décompte terminé, détection du tir activée ...");
                    duelCountdown = false;
                    playLuckyShoot();
                        
                    setTimeout(() => { duelCountdownEl.style.display = 'none';  }, 500);
                }
            }, 1000);
        }

        function playLuckyShoot() {
            if (!mixer || duelGunTriggered) return;

            const rigClip = luckyShootClips.find(c => c.name === 'Lucky-rig-shoot');
            const gunClip = luckyShootClips.find(c => c.name === 'Lucky-gun-shoot');
            const rigBackClip = luckyShootClips.find(c => c.name === 'Lucky-rig-back');
            const gunBackClip = luckyShootClips.find(c => c.name === 'Lucky-gun-rest');
            const victoryClip = clips.find(c => c.name === 'Victory Idle 2');

            if (!rigClip || !gunClip || !rigBackClip || !gunBackClip) {
                console.warn("Lucky shoot clips not found in", luckyShootClips.map(c => c.name));
                return;
            }

            if (!victoryClip) {
                console.warn("Victory Idle 2 clip not found in", clips.map(c => c.name));
                return;
            }

            currentAction?.stop();
            currentAction = undefined;

            luckyRigAction = mixer.clipAction(rigClip);
            luckyRigAction.setLoop(LoopOnce, 1);
            luckyRigAction.clampWhenFinished = true;
            luckyRigAction.reset().play();

            luckyGunAction = mixer.clipAction(gunClip);
            luckyGunAction.setLoop(LoopOnce, 1);
            luckyGunAction.clampWhenFinished = true;
            luckyGunAction.reset().play();

            luckyWinPlaying = true;

            // Assign module-level refs so triggerDuelShot() can cancel them if the player draws
            luckyRigBackAction = mixer.clipAction(rigBackClip);
            luckyGunBackAction = mixer.clipAction(gunBackClip);
            victoryAction = mixer.clipAction(victoryClip);

            // Non-null local aliases — safe because we just assigned all four above
            const luckyShootAction  = luckyRigAction!;
            const capturedRigBack   = luckyRigBackAction!;
            const capturedGunBack   = luckyGunBackAction!;
            const capturedVictory   = victoryAction!;

            console.log({ luckyShootAction, capturedRigBack, capturedGunBack, capturedVictory });

            // Trigger des actions à la fin de chaque animation de tir de Lucky pour gérer les différents cas 
            // (tir normal, tir interrompu par le joueur, fin de l'animation de victoire)
            const onLuckyWin = (e: { action: AnimationAction }) => {

                console.log("Animation finished during Lucky's shoot sequence:", e.action.getClip().name);
                if (!luckyWinPlaying) return; // player drew first — already cancelled

                if (e.action === luckyShootAction) {
                    // Fin du clip lucky-rig-shoot : tir
                    luckyWins = true;
                    playOneShot(gunShotBuffer);

                    // Stop the shoot actions so they don't fight the back animations
                    // (clampWhenFinished keeps them at weight=1 which conflicts with the next clips)
                    luckyRigAction?.stop();
                    luckyGunAction?.stop();

                    console.log("Lucky shoot finished, rangement du gun ...");
                    capturedGunBack.setLoop(LoopOnce, 1);
                    capturedGunBack.clampWhenFinished = true;
                    capturedGunBack.reset().play();

                    capturedRigBack.setLoop(LoopOnce, 1);
                    capturedRigBack.clampWhenFinished = true;
                    capturedRigBack.reset().play();

                } else if (e.action === capturedGunBack) {

                    console.log("Rangement du gun finished, victoire ...");

                    capturedGunBack.stop();
                    capturedRigBack.stop();

                    // Play Victory animation
                    capturedVictory.setLoop(LoopOnce, 1);
                    capturedVictory.clampWhenFinished = true;
                    capturedVictory.reset().play();

                    // Message
                    duelCountdownEl.style.display = 'flex';
                    duelCountEl.innerHTML = 'Lucky<br>gagne !';
                    setTimeout(() => { duelCountdownEl.style.display = 'none'; }, 3000);

                } else if (e.action === capturedVictory) {
                    // Fin de la séquence Lucky wins
                    mixer!.removeEventListener('finished', onLuckyWin);
                    
                    console.log("Victory finished, reset state ...");
                    initgunsPosition();

                    // After victory animation, reset state to detection mode
                    setTimeout(() => {
                        mixer?.stopAllAction();
                        luckyWinPlaying = false;
                        luckyRigAction = undefined;
                        luckyGunAction = undefined;
                        duelMode = false;
                        duelCountdown = false;
                        duelGunTriggered = false;
                        duelShootDetected = false;
                        duelGunGrabbedL = false;
                        duelGunGrabbedR = false;
                        animationPlaying = false;
                    }, 500);
                
                } 
            }
                 
            mixer.addEventListener('finished', onLuckyWin);
        }

        function triggerDuelShot() {
            // Pas de détection pendant le countdown, et pas de tir multiple pendant le duel
            // Pas de détection si Lucky a tiré avant
            if (!duelMode || duelCountdown || duelGunTriggered || luckyWins || !mixer) return;
            duelGunTriggered = true;
            
            playOneShot(gunShotBuffer);
            showBulletHole();

            // Player drew first — cancel Lucky's shoot animation
            if (luckyWinPlaying) {
                luckyWinPlaying = false;
                luckyRigAction?.stop(); luckyRigAction = undefined;
                luckyGunAction?.stop(); luckyGunAction = undefined;
                luckyRigBackAction?.stop(); luckyRigBackAction = undefined;
                luckyGunBackAction?.stop(); luckyGunBackAction = undefined;
                victoryAction?.stop(); victoryAction = undefined;
            }

            
            const hitClip = clips.find(c => c.name === 'Falling Back Death');
            if (!hitClip) { duelGunTriggered = false; console.warn("Hit clip not found"); return; }

            // Start "Falling Back Death"
            currentAction?.stop();
            currentAction = mixer.clipAction(hitClip);
            currentAction.setLoop(LoopOnce, 1);
            currentAction.clampWhenFinished = true;
            currentAction.reset().play();

            // When "Falling Back Death" ends, chain into "Getting Up"
            const onFallFinished = (e: { action: AnimationAction }) => {
                if (e.action !== currentAction) { console.warn("Unexpected action finished", e.action); return; }
                mixer!.removeEventListener('finished', onFallFinished);

                const layClip = clips.find(c => c.name === 'Getting Up');
                if (!layClip || !mixer) { duelGunTriggered = false; console.warn("Lay clip not found"); return; }

                // console.log("finie ... lecture animation de relevé...");
                currentAction?.stop();
                currentAction = mixer.clipAction(layClip);
                currentAction.setLoop(LoopOnce, 1);
                currentAction.clampWhenFinished = true;
                currentAction.reset().play();
                duelLayIdlePlaying = true;

                // Message
                duelCountdownEl.style.display = 'flex';
                duelCountEl.textContent = 'Bravo !';
                setTimeout(() => { duelCountdownEl.style.display = 'none'; }, 3000);


                const onGetUpFinished = (e: { action: AnimationAction }) => {
                    if (e.action !== currentAction) { console.warn("Unexpected action finished", e.action); return; }
                    mixer!.removeEventListener('finished', onGetUpFinished);

                    console.log("finie ... reset state du duel...");
                    
                    hideBulletHole();
                    duelMode = false;
                    duelCountdown = false;
                    duelGunTriggered = false;
                    duelLayIdlePlaying = false;
                    duelShootDetected = false;
                    duelGunGrabbedL = false;
                    duelGunGrabbedR = false;
                    animationPlaying = false;
                }

                mixer.addEventListener('finished', onGetUpFinished);

            };    

            mixer.addEventListener('finished', onFallFinished);
        }

        // — Rig management —

        let lukeBind: RecordableBindingHandler | undefined;
        let disposeOld: (() => void) | undefined;

        // Upper arm bones — needed by isFacingCamera()
        let upperArmL: Object3D | undefined;
        let upperArmR: Object3D | undefined;

        // Foot bones — needed for floor-snapping
        let footL: Object3D | undefined;
        let footR: Object3D | undefined;

        let legL: Object3D | undefined;
        let legR: Object3D | undefined;
        let gunL: Object3D | undefined;
        let gunR: Object3D | undefined;

        // Initial local transforms of the guns in their holsters (restored on release)
        let gunLRestPos = new Vector3();
        let gunLRestQuat = new Quaternion();
        let gunRRestPos = new Vector3();
        let gunRRestQuat = new Quaternion();

        // Gun grab state — rising-edge toggle per gun
        // let gunLHeld = false;
        // let gunRHeld = false;
        

        // Rising-edge flags for duel gun-grab detection
        let gunLWasClose = false;
        let gunRWasClose = false;

        // In duelMode, detect if the player has triggered a shot — rising edge only        
        let duelGunGrabbedL = false; // 1: Grab gun at hip level,
        let duelGunGrabbedR = false; // 1: Grab gun at hip level,
        let duelShootDetected = false; // 2: Raised hand after grab (to prevent accidental shoot detection while just putting hand on holster)

        // Hands-above-eye rising-edge state
        let handsAboveEyeWas = false;

        // Reusable vectors for update loop
        const _posA = new Vector3();
        const _posB = new Vector3();
        const _posC = new Vector3();
        const initialPosition = new Vector3(0,0,0);


        function setActiveRig(gltf: GLTF) {
            disposeOld?.();

            const root = gltf.scene;
            root.position.set(0, 0, 0);
            root.rotation.set(0, 0, 0);
            root.scale.set(1, 1, 1);

            root.traverse((child: Object3D) => {
                if (child instanceof Mesh) {
                    child.frustumCulled = false;
                    child.castShadow = shadowOpt.castShadow;
                    child.receiveShadow = true;
                }
            });

            modelRoot = root;
            scene.add(root);

            // Ajout des animations de tir de Lucky à part pour pouvoir les jouer en cas de duel
            luckyShootClips.push(...gltf.animations);

            upperArmL = root.getObjectByName("upper_armL");
            upperArmR = root.getObjectByName("upper_armR");
            footL = root.getObjectByName("footL");
            footR = root.getObjectByName("footR");
            legL = root.getObjectByName("thighL");
            legR = root.getObjectByName("thighR");
            gunL = root.getObjectByName("Gun-L");
            gunR = root.getObjectByName("Gun-R");

            // Compute all gun local transforms from raw GLB world matrices
            root.updateMatrixWorld(true);
            const _m = new Matrix4();
            const _s = new Vector3();
            if (gunL && legL) {
                _m.copy(legL.matrixWorld).invert().multiply(gunL.matrixWorld);
                _m.decompose(gunLRestPos, gunLRestQuat, _s);
            }
            if (gunR && legR) {
                _m.copy(legR.matrixWorld).invert().multiply(gunR.matrixWorld);
                _m.decompose(gunRRestPos, gunRRestQuat, _s);
            }

            if (gunL && legL && gunR && legR) {
                initgunsPosition();
            }


            // Reset duel detection rising-edge state for the new rig
            gunLWasClose = false;
            gunRWasClose = false;
            // Start true so the first detection frame can't accidentally fire startDuel —
            // the user must lower their hands at least once before the rising edge triggers.
            handsAboveEyeWas = true;

            disposeOld = () => {
                debugAxesHelpers.forEach((h) => h.parent?.remove(h));
                debugAxesHelpers.length = 0;
                mixer?.stopAllAction();
                mixer = undefined;
                scene.remove(root);
                root.traverse((obj: Object3D) => {
                    const mesh = obj as Mesh | SkinnedMesh;
                    if ((mesh as Mesh).isMesh || (mesh as SkinnedMesh).isSkinnedMesh) {
                        mesh.geometry?.dispose();
                        const mats = Array.isArray(mesh.material)
                            ? mesh.material
                            : mesh.material
                            ? [mesh.material as Material]
                            : [];
                        mats.forEach((mat) => {
                            Object.values(mat).forEach((v) => {
                                if ((v as Texture)?.isTexture) (v as Texture).dispose();
                            });
                            mat.dispose();
                        });
                    }
                    if ((obj as SkinnedMesh).isSkinnedMesh) {
                        (obj as SkinnedMesh).skeleton?.dispose();
                    }
                });
                disposeOld = undefined;
            };


            const rig = root.getObjectByName("rig") ?? root;
            lukeBind = tracker.bind(rig);

            currentAction?.stop();
            currentAction = undefined;
            animationPlaying = false;
            mixer = new AnimationMixer(root);
            mixer.addEventListener("finished", () => {
                if (duelLayIdlePlaying) {
                    duelLayIdlePlaying = false;
                    duelCountdown = false;
                    animationPlaying = false;
                    duelGunTriggered = false;
                    return;
                }
                if (animationPlaying && !(tracker.poseTracker?.detected)) {
                    playNextIdleAnimation();
                }
            });
        }

        
        function isFacingCamera(): boolean {
            if (!upperArmL || !upperArmR) return false;
            upperArmL.getWorldPosition(_posA);
            upperArmR.getWorldPosition(_posB);
            return Math.abs(_posA.z - _posB.z) < 0.05;
        }

        let lastLeftWristPos = new Vector3();
        let lastRightWristPos = new Vector3();

        function detectGunGrabDuel() {
            if (duelShootDetected) return;
            const pt = tracker.poseTracker;
            if (!pt) return;

            const dist2D = (a: Vector3, b: Vector3) =>
                Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

            // Left: leftWrist approaching leftLeg (thigh / holster area)
            pt.getNormalizedMarkPosition('leftWrist' as any, _posA);
            pt.getNormalizedMarkPosition('leftLeg' as any, _posB);
            pt.getNormalizedMarkPosition('leftElbow' as any, _posC);
            
            if (duelGunGrabbedL)
            {
                // Step 2 : grab detected, now wait for the hand to be raised (wrist above elbow)
                // AND arm pointing toward camera (wrist x < elbow x by ARM_X_TOLERANCE)
                const armFacingL = Math.abs(_posA.x - _posC.x) < ARM_X_TOLERANCE;
                const closeL = Math.abs(_posA.y - _posC.y) < WRIST_ABOVE_ELBOW_DISTANCE;
                // console.log('Left wrist/elbow Δy:', Math.abs(_posA.y - _posC.y).toFixed(2), 'Δx:', Math.abs(_posA.x - _posC.x).toFixed(2), '— facing:', armFacingL, 'close:', closeL);
                if (closeL && armFacingL && !gunLWasClose) {
                    console.log('Shoot L detected !');
                    duelShootDetected = true;
                    triggerDuelShot();
                    return;
                }
                gunLWasClose = closeL;
            } else {
                // Step 1 : detect grab (wrist close to leg)
                const closeL = dist2D(_posA, _posB) < GUN_GRAB_DISTANCE;
                // console.log('Left wrist→leg:', dist2D(_posA, _posB).toFixed(2), '— close:', closeL);
                if (closeL && !gunLWasClose) {
                    console.log('Gun L grabbed !');
                    duelGunGrabbedL = true;
                    return;
                }
                gunLWasClose = closeL;
            }

            // Right: rightWrist approaching rightLeg (thigh / holster area)
            pt.getNormalizedMarkPosition('rightWrist' as any, _posA);
            pt.getNormalizedMarkPosition('rightLeg' as any, _posB);
            pt.getNormalizedMarkPosition('rightElbow' as any, _posC);
            
            if (duelGunGrabbedR)
            {
                // Step 2 : grab detected, now wait for the hand to be raised (wrist above elbow)
                // AND arm pointing toward camera (wrist x < elbow x by ARM_X_TOLERANCE)
                const armFacingR = Math.abs(_posA.x - _posC.x) < ARM_X_TOLERANCE;
                const closeR = Math.abs(_posA.y - _posC.y) < WRIST_ABOVE_ELBOW_DISTANCE;
                // console.log('Right wrist/elbow Δy:', Math.abs(_posA.y - _posC.y).toFixed(2), 'Δx:',  Math.abs(_posA.x - _posC.x).toFixed(2), '— facing:', armFacingR, 'close:', closeR);
                if (closeR && armFacingR && !gunRWasClose) {
                    console.log('Shoot R detected !');
                    duelShootDetected = true;
                    triggerDuelShot();
                    return;
                }
                gunRWasClose = closeR;
            } else {
                // Step 1 : detect grab (wrist close to leg)
                const closeR = dist2D(_posA, _posB) < GUN_GRAB_DISTANCE;
                // console.log('Right wrist→leg:', dist2D(_posA, _posB).toFixed(2), '— close:', closeR);
                if (closeR && !gunRWasClose) {
                    console.log('Gun R grabbed !');
                    duelGunGrabbedR = true;
                    return;
                }
                gunRWasClose = closeR;
            }

        }

        function detectDuelMode() {
            if (duelMode || duelCountdown || !isFacingCamera()) return;
            const pt = tracker.poseTracker;
            if (!pt) return;
            // normalized y: 0 = top of screen, 1 = bottom — "above head" means smaller y
            const headPos = pt.getNormalizedMarkPosition('head' as any, _posC);
            const lwPos = pt.getNormalizedMarkPosition('leftWrist' as any, _posA);
            const rwPos = pt.getNormalizedMarkPosition('rightWrist' as any, _posB);
            const handsAbove = lwPos.y < headPos.y - 0.1 && rwPos.y < headPos.y - 0.1; // false; //
            if (handsAbove && !handsAboveEyeWas) startDuel();
            handsAboveEyeWas = handsAbove;
        }

        function toggleAnimation() {
            if (!mixer || !animState.clip) return;
            if (animationPlaying) {
                currentAction?.stop();
                currentAction = undefined;
                animationPlaying = false;
            } else {
                const clip = clips.find((c) => c.name === animState.clip);
                if (!clip) return;
                currentAction = mixer.clipAction(clip);
                currentAction.reset().play();
                animationPlaying = true;
            }
        }

        let idleAnimIndex = -1;

        const IDLE_CROSSFADE_DURATION = 1; // seconds

        function playNextIdleAnimation() {
            if (!mixer || clips.length === 0) return;
            let next = idleAnimIndex === -1 ? clips.map(el => el.name).indexOf("Jump 2") : idleAnimIndex;
            const excludeClips = ['duel-idle', 'Falling Back Death', 'Getting Up'];
            if (clips.length > 1) {
                while (next === idleAnimIndex || excludeClips.includes(clips[next].name)) next = Math.floor(Math.random() * clips.length);
            } else {
                next = 0;
            }
            idleAnimIndex = next;

            const prevAction = currentAction;
            currentAction = mixer.clipAction(clips[next]);

            // reset() clears stale timeScale/weight fades left by a previous crossFadeTo,
            // preventing timeScale from cascading toward 0 across iterations.
            currentAction.reset();
            currentAction.setLoop(LoopOnce, 1);
            currentAction.clampWhenFinished = true;

            console.log("Playing next animation:", clips[next].name);

            if (prevAction) {
                // warping:false avoids modifying timeScale on either action —
                // warping was the root cause of the freeze after ~6 iterations.
                prevAction.crossFadeTo(currentAction, IDLE_CROSSFADE_DURATION, false);
                // Stop the outgoing action once the blend finishes so it doesn't
                // accumulate as a zombie in the mixer.
                const toStop = prevAction;
                setTimeout(() => toStop.stop(), IDLE_CROSSFADE_DURATION * 1000);
            } else {
                currentAction.fadeIn(IDLE_CROSSFADE_DURATION);
            }
            currentAction.play();
            animationPlaying = true;
        }

        function moveToInitialPosition() {
            if (!modelRoot) return;
            const direction = new Vector3().subVectors(initialPosition, modelRoot.position);
            const distance = direction.length();
            
            if (distance > 0.025) { // Threshold to prevent jitter
                direction.normalize(); // Normalize the direction vector
                const movement = direction.multiplyScalar(0.025); // Calculate movement
                modelRoot?.position.add(movement); // Update character position
            }
        }


        function initgunsPosition() {
            // Set Guns initial position in the holster and parent them to the gunholds
            if (gunL && legL && gunR && legR) {
                legL.add(gunL);
                gunL.position.copy(gunLRestPos);
                gunL.quaternion.copy(gunLRestQuat);
                // gunLHeld = false;

                legR.add(gunR);
                gunR.position.copy(gunRRestPos);
                gunR.quaternion.copy(gunRRestQuat);
                // gunRHeld = false;
            } else {
                console.warn("Cannot initialize guns position: gun or leg not found", { gunL, legL, gunR, legR });
            }
        }


        new GLTFLoader().load(DEFAULT_MODEL, (gltf) => { setActiveRig(gltf); onAssetLoaded(); });

        // — Camera zoom animation —
        const CAMERA_ANIM_DURATION = 1.5; // seconds
        const camPosIn  = new Vector3(0, 0.9, 0.55); // (0, 0.84, 0.51); // 
        
        const camPosOut = new Vector3( -1.12, 0.54, -0.96 ); // (-1.54, 1.59, -1.45); // 
        const camLookIn  = new Vector3(0, 0.9, 3.0); // (0, 0.5, 3); // 
        const camLookOut = new Vector3(0.04, 0.95, 2.27); // (0, 0.88, 3.05);  // 
        const _camLerp = new Vector3();
        let cameraT = 0;       // 0 = "in" (detected), 1 = "out" (no detection)
        let cameraTarget = 0;

        function zoomOut() { cameraTarget = 1; }
        function zoomIn()  { cameraTarget = 0; }

        // Returns true while animating (caller should skip ctrl.update() in that case)
        function updateCameraAnim(delta: number): boolean {
            if (cameraT === cameraTarget) return false;
            const step = delta / CAMERA_ANIM_DURATION;
            cameraT = cameraTarget === 1
                ? Math.min(1, cameraT + step)
                : Math.max(0, cameraT - step);
            const t = cameraT * cameraT * (3 - 2 * cameraT); // smoothstep easing
            camera.position.lerpVectors(camPosIn, camPosOut, t);
            _camLerp.lerpVectors(camLookIn, camLookOut, t);
            camera.lookAt(_camLerp);
            if (cameraT === cameraTarget) {
                // Sync OrbitControls internal state so it doesn't snap on next ctrl.update()
                ctrl.target.copy(_camLerp);
                ctrl.update();
            }
            return true;
        }

        let wasDetected = false;

        let frameCount = 0;

        // — Main update loop —
        return (delta: number) => {
            if (!updateCameraAnim(delta)) ctrl.update();

            const detected = tracker.poseTracker?.detected ?? false;

            // Two modes : 
            // duelMode = false : normal detection of the shadow & random idle animation if not detected
            // duelMode = true : countdown -> detect the duel pose to trigger the duel animation, ignore shadow detection and idle animations

            // if (frameCount++ > 30) {
            //     console.log("update loop", { duelMode, duelCountdown, duelGunTriggered, animationPlaying });
            //     frameCount = 0;
            // }

            if (duelMode) {

                // - Duel mode -
                if (wasDetected && !detected) {
                    if (duelLayIdlePlaying) {
                        console.log("Person disappeared during duel, waiting for reset till animations end...");                        
                    } else {
                        // Person disappeared during the duel — reset everything
                        console.log("Person disappeared during duel, resetting state");
                        duelMode = false;
                        duelCountdown = false;
                        duelGunTriggered = false;
                        duelShootDetected = false;
                        duelGunGrabbedL = false;
                        duelGunGrabbedR = false;
                        mixer?.stopAllAction();
                        currentAction = undefined;
                        animationPlaying = false;
                        idleAnimIndex = -1;
                        playNextIdleAnimation();
                    }   
                }

                // Safety catch: animation ended while nobody was there (e.g. after the
                // duelLayIdlePlaying "finished" handler set animationPlaying = false)
                if (!detected && !animationPlaying) {
                    duelMode = false;
                    duelCountdown = false;
                    duelGunTriggered = false;
                    duelShootDetected = false;
                    duelGunGrabbedL = false;
                    duelGunGrabbedR = false;
                    idleAnimIndex = -1;
                    playNextIdleAnimation();
                }

                // In duel mode : detect shoot after countdown
                if (! (duelShootDetected || duelCountdown)) {
                    detectGunGrabDuel();
                }

            } else {
                // - Normal mode -
                if (!wasDetected && detected) {
                    zoomIn();
                    if (animationPlaying) {
                        // Person re-detected — stop idle animation so tracking takes over
                        mixer?.stopAllAction();
                        currentAction = undefined;
                        animationPlaying = false;
                    }
                }

                if (wasDetected && !detected) {
                    zoomOut();
                    idleAnimIndex = -1;
                    playNextIdleAnimation();
                }
            }
            
            // Update last detection state variable
            wasDetected = detected;

            if (animationPlaying && mixer) {
                mixer.update(delta);
                
                // In normal mode, if not detected, move character to initial position while playing idle animation
                moveToInitialPosition();

            } else if (detected) {
                lukeBind?.update(delta);

                // Tuning character position
                if (modelRoot) {
                    // position character horizontally to follow the detected person
                    const hip = tracker.poseTracker!.getNormalizedMarkPosition('hips' as any, _posA);
                    modelRoot.position.x = (hip.x - 0.5) * 2;
                    modelRoot.position.y = Math.max(-0.5, (0.5 - hip.y) * 2); // invert so up = positive

                    // Floor-snap: if both feet are reliably detected and either foot
                    // is below the floor (world Y < 0), push the rig up so the lowest
                    // foot sits exactly on y = 0.
                    if (tracker.poseTracker?.areFeetDetected()) {
                        const yL = footL ? (footL.getWorldPosition(_posB).y) : 0;
                        const yR = footR ? (footR.getWorldPosition(_posC).y) : 0;
                        const lowestFoot = Math.min(yL, yR);
                        if (lowestFoot < 0) modelRoot.position.y -= lowestFoot;
                    }

                    // if (frameCount++ >= 30) {
                    //     frameCount = 0;
                    //     const heel = tracker.poseTracker!.getNormalizedMarkPosition('leftFoot' as any, _posB);
                    //     const feetVisible = tracker.poseTracker?.areFeetDetected();
                    //     console.log('LeftFoot visible:', feetVisible, '— X,Y position (normalized):', heel.x.toFixed(2), heel.y.toFixed(2));
                    // }
                }
                // updateGunGrab();
                if (!duelMode) { detectDuelMode(); }
            }

            if (debugBonesEnabled && tracker.poseTracker) {
                const pt = tracker.poseTracker;
                for (let i = 0; i < POSE_PAIRS.length; i++) {
                    const b = i * 6;
                    pt.getMarkPosition(POSE_PAIRS[i][0] as any, _posA);
                    pt.getMarkPosition(POSE_PAIRS[i][1] as any, _posB);
                    skeletonBuf[b]   = _posA.x; skeletonBuf[b+1] = _posA.y*-1; skeletonBuf[b+2] = _posA.z*-1;
                    skeletonBuf[b+3] = _posB.x; skeletonBuf[b+4] = _posB.y*-1; skeletonBuf[b+5] = _posB.z*-1;

                    pt.getNormalizedMarkPosition(POSE_PAIRS[i][0] as any, _posA);
                    pt.getNormalizedMarkPosition(POSE_PAIRS[i][1] as any, _posB);
                    skeletonNormBuf[b]   = _posA.x * 2; skeletonNormBuf[b+1] = _posA.y * -2; skeletonNormBuf[b+2] = _posA.z * -2;
                    skeletonNormBuf[b+3] = _posB.x * 2; skeletonNormBuf[b+4] = _posB.y * -2; skeletonNormBuf[b+5] = _posB.z * -2;
                }
                skeletonGeo.attributes.position.needsUpdate = true;
                skeletonNormGeo.attributes.position.needsUpdate = true;
            }
        };
    },
};
