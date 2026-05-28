import {
    AnimationAction,
    AnimationClip,
    AnimationMixer,
    LoopOnce,
    LoopRepeat,
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
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    MeshPhongMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Scene,
    SkinnedMesh,
    SpotLight,
    SpotLightHelper,
    Texture,
    TextureLoader,
    Vector3,
    WebGPURenderer,
    LoopPingPong,
} from "three/webgpu";

import { GLTFLoader, OrbitControls } from "three/examples/jsm/Addons.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Inspector } from "three/examples/jsm/inspector/Inspector.js";
import { DemoHandler } from "./demo-type";
import { RecordableBindingHandler, TrackerHandler } from "lucky-luke-duel";

const DEFAULT_MODEL = import.meta.env.BASE_URL +  "Lucky-Luke-simplified.glb";
const GRAB_THRESHOLD = 0.15; // world-unit proximity to trigger grab/release
const X_POSE_ROTATION = -10; // degrees, applied around hips local X axis
const DEBUG_MODE = true;
const USE_WEBCAM_BY_DEFAULT = true;

export const luckyLukeDemo: DemoHandler = {
    name: "lucky-luke-demo",
    trackerConfig: {
        displayScale: 0.5,
        ignoreFace: true,
        ignoreHands: true,
        debugVideo: import.meta.env.BASE_URL + "Lucky-luke.mp4",
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

        camera.position.set(0, 0.18, 0.5);
        camera.lookAt(0, 0.7, 3);
        ctrl.target.set(0,  0.7, 3);
        ctrl.update();

        // - Light directionnal - 

        const dirLight = new DirectionalLight( 0xffffff, 2 );
        dirLight.position.set( 0, 0.5, -3 );   // behind character, elevated
        dirLight.target.position.set( 0, 0, 3 ); // aimed at the wall
        
        dirLight.castShadow = true;
        
        dirLight.shadow.mapSize.width = 4096;
        dirLight.shadow.mapSize.height = 4096;
        dirLight.shadow.intensity = 1;

        scene.add( dirLight );
        scene.add( dirLight.target );

        const dirLightHelper = new DirectionalLightHelper( dirLight, 10 );
        scene.add( dirLightHelper );

        const spotLight = new SpotLight( 0xffffff, 10, 10, Math.PI / 5, 0.5 );
        spotLight.position.set( 0, 2.8, 2 );
        spotLight.castShadow = false;
        spotLight.target.position.set( 0, 0, 1 ); 
        scene.add( spotLight );
        scene.add( spotLight.target );

        const spotLightHelper = new SpotLightHelper( spotLight, 10 );
        scene.add( spotLightHelper );
        
        // Floor plane
        const floorMat = new MeshPhongMaterial( {
					color: 0xffffff,
					shininess: 150,
					specular: 0xffffff
				} );
		const floor = new Mesh( new PlaneGeometry( 10, 10 ), floorMat ); 
		floor.rotation.x = - Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Palissade
        const wallTexture = new TextureLoader().load("palissade.jpg");
        const wallMaterial = new MeshLambertMaterial( { color: 0xffffff, map: wallTexture } );
        const wallHeight = 3;
        const wallWidth = 5;	
        const wall = new Mesh( new PlaneGeometry( wallWidth, wallHeight ), wallMaterial );
        wall.rotation.y = Math.PI;
        wall.position.z = 2.5;
        wall.position.y += 0.5 * wallHeight;
        wall.receiveShadow = true;
        //wall.scale.x = image.width/50.0
        // wall.scale.y = image.height/50.0;
        scene.add( wall );
        
        // — Inspector panels —

        const inspector = new Inspector();
        renderer.inspector = inspector;
        inspector.init();
        if (USE_WEBCAM_BY_DEFAULT) {
            tracker.setVideoFromWebcam(false).catch((err) => {
                alert("Failed to access camera. Please allow camera access and try again. Err: " + err);
            });
        }

        const applyProdMode = (on: boolean) => {
            (inspector.domElement as HTMLElement).style.display = on ? 'none' : '';
            (tracker.domElement as HTMLElement).style.display = on ? 'none' : '';
        };

        // — Loading overlay —
        const loadingOverlay = document.getElementById('loading-overlay')!;
        const progressFill = document.getElementById('loading-fill') as HTMLElement;
        const startBtn = document.getElementById('start-btn') as HTMLElement;

        const TOTAL_ASSETS = 6; // 7; 
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
        prodCheckbox.addEventListener('change', () => applyProdMode(prodCheckbox.checked));
        if (DEBUG_MODE) applyProdMode(false);

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
                console.log("Camera position:", camera.position.toArray().map(n => +n.toFixed(3)));
                console.log("Camera lookAt (target):", ctrl.target.toArray().map(n => +n.toFixed(3)));
                console.log("Camera look direction:", camera.getWorldDirection(new Vector3()).toArray().map(n => +n.toFixed(3)));
                console.log("Camera rotation (deg):", [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(r => +(r * 180 / Math.PI).toFixed(1)));
            }
        }, "logCamera").name("Log camera");
        modelPanel
            .add({ axisHelpers: true }, "axisHelpers")
            .name("Axis helpers")
            .onChange((v: boolean) => {
                axesHelper.visible = v;
                dirLightHelper.visible = v;
                spotLightHelper.visible = v;
            });

        // — Animations —

        let mixer: AnimationMixer | undefined;
        let clips: AnimationClip[] = [];
        let currentAction: AnimationAction | undefined;
        let animationPlaying = false;
        const animState = { clip: "" };

        const animPanel = inspector.createParameters("Animations");
       
        new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "animations.glb")
            .then((gltf) => {
                clips.push(...gltf.animations);
                if (gltf.animations.length === 0) return;
                animState.clip = gltf.animations[0].name;
                animPanel.add(animState, "clip", gltf.animations.map((c) => c.name)).name("Animation");
                animPanel.add({ toggle: toggleAnimation }, "toggle").name("Play / Stop");
            })
            .catch((err) => console.warn("Could not load animations.glb:", err))
            .finally(onAssetLoaded);
        
        // — Audio —

        let audioCtx: AudioContext | undefined;

        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "Duel.mp3")
            .catch((err) => console.warn("Could not load Duel.mp3:", err))
            .finally(onAssetLoaded);

        let gunLoadBuffer: AudioBuffer | undefined;
        let gunReleaseBuffer: AudioBuffer | undefined;
        let gunShotBuffer: AudioBuffer | undefined;
        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "GunLoad.mp3")
            .then((buf) => { gunLoadBuffer = buf; })
            .catch((err) => console.warn("Could not load GunLoad.mp3:", err))
            .finally(onAssetLoaded);
        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "GunRelease.mp3")
            .then((buf) => { gunReleaseBuffer = buf; })
            .catch((err) => console.warn("Could not load GunRelease.mp3:", err))
            .finally(onAssetLoaded);
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

        const duelCountdownEl = document.getElementById('duel-countdown') as HTMLElement;
        const duelCountEl = document.getElementById('duel-count') as HTMLElement;

        function startDuel() {
            console.log("startDuel", { duelMode, duelCountdown, mixer });

            if (duelMode || duelCountdown || !mixer) return; // ignore if already in duel mode, or if countdown is in progress, or if mixer is not ready
            duelMode = true;
            duelShootDetected = false;
            duelCountdown = true;
            duelGunTriggered = false;

            const duelClip = clips.find(c => c.name === 'Idle duel');
            if (!duelClip) {
                console.warn("Could not find duel clip 'Idle duel' in", clips.map(c => c.name));
                duelCountdown = false;
                return; }

            // Start duel animation and countdown
            currentAction?.stop();
            currentAction = mixer.clipAction(duelClip);
            currentAction.setLoop(LoopPingPong, 5);
            currentAction.reset().play();
            animationPlaying = true;

            let count = 5;
            duelCountEl.textContent = String(count);
            duelCountdownEl.style.display = 'flex';
            
            const tick = setInterval(() => {
                count--;
                if (count > 1) {
                    duelCountEl.textContent = String(count);
                } else {
                    clearInterval(tick);
                    duelCountEl.textContent = '1';
                    setTimeout(() => {
                        duelCountdownEl.style.display = 'none';
                        duelCountdown = false;
                    }, 400);

                    console.log("Décompte terminé, attente du tir...");
                }
                
            }, 1000);
        }

        function triggerDuelShot() {
            // Pas de détection pendant le countdown, et pas de tir multiple pendant le duel
            if (!duelMode || duelCountdown || duelGunTriggered || !mixer) return;
            duelGunTriggered = true;
            //duelMode = false;
            //duelCountdown = true;

            setTimeout(() => playOneShot(gunShotBuffer), 150);

            const hitClip = clips.find(c => c.name === 'Fall dead');
            if (!hitClip) { duelCountdown = false; duelGunTriggered = false; return; }

            currentAction?.stop();
            currentAction = mixer.clipAction(hitClip);
            currentAction.setLoop(LoopOnce, 1);
            currentAction.clampWhenFinished = true;
            currentAction.reset().play();
            // animationPlaying = true;

            setTimeout(() => {
                if (!mixer) { duelCountdown = false; duelGunTriggered = false; return; }
                const layClip = clips.find(c => c.name === 'Stand up');
                if (!layClip) { duelCountdown = false; duelGunTriggered = false; animationPlaying = false; return; }
                currentAction?.stop();
                currentAction = mixer.clipAction(layClip);
                currentAction.setLoop(LoopOnce, 1);
                currentAction.clampWhenFinished = true;
                currentAction.reset().play();
                duelLayIdlePlaying = true;
                // mixer "finished" handler finalises the sequence
                setTimeout(() => {
                    duelMode = false;
                    duelCountdown = false;
                    duelGunTriggered = false;
                    if (!mixer) { return; }
                    currentAction?.stop();
                    currentAction = undefined;
                }, 9000);
            }, 5000);
        }

        // — Rig management —

        let lukeBind: RecordableBindingHandler | undefined;
        let disposeOld: (() => void) | undefined;

        // Bone / mesh references — reset each time a new rig is loaded
        let handL: Object3D | undefined;
        let handR: Object3D | undefined;
        let forearmL: Object3D | undefined;
        let forearmR: Object3D | undefined;
        let upperArmL: Object3D | undefined;
        let upperArmR: Object3D | undefined;
        let gunholdL: Object3D | undefined;
        let gunholdR: Object3D | undefined;
        let gunL: Object3D | undefined;
        let gunR: Object3D | undefined;

        // Initial local transforms of the guns in their holsters (restored on release)
        let gunLRestPos = new Vector3();
        let gunLRestQuat = new Quaternion();
        let gunRRestPos = new Vector3();
        let gunRRestQuat = new Quaternion();

        // Gun grab state — rising-edge toggle per gun
        let gunLHeld = false;
        let gunLWasClose = false;
        let gunRHeld = false;
        let gunRWasClose = false;

        // In duelMode, detect if the player has triggered a shot by bringing either hand close to its respective holster — rising edge only, must be reset by lowering hands after each shot
        let duelShootDetected = false;

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
            
            // Resolve bones & mesh objects by their Blender-exported names
            handL     = root.getObjectByName("handL");
            handR     = root.getObjectByName("handR");
            forearmL  = root.getObjectByName("forearmL");
            forearmR  = root.getObjectByName("forearmR");
            upperArmL = root.getObjectByName("upper_armL");
            upperArmR = root.getObjectByName("upper_armR");
            gunholdL  = root.getObjectByName("gunholdL");
            gunholdR  = root.getObjectByName("gunholdR");
            gunL      = root.getObjectByName("Gun-L");
            gunR      = root.getObjectByName("Gun-R");

            // Compute all gun local transforms from raw GLB world matrices
            root.updateMatrixWorld(true);
            const _m = new Matrix4();
            const _s = new Vector3();
            if (gunL && gunholdL) {
                _m.copy(gunholdL.matrixWorld).invert().multiply(gunL.matrixWorld);
                _m.decompose(gunLRestPos, gunLRestQuat, _s);
            }
            if (gunR && gunholdR) {
                _m.copy(gunholdR.matrixWorld).invert().multiply(gunR.matrixWorld);
                _m.decompose(gunRRestPos, gunRRestQuat, _s);
            }

            if (gunL && gunholdL && gunR && gunholdR) {
                initGunsPosition();
            }
            // Rebuild debug axes helpers for the new rig (hidden by default)
            debugAxesHelpers.forEach((h) => h.parent?.remove(h));
            debugAxesHelpers.length = 0;
            for (const bone of [handL, handR, gunL, gunR]) {
                if (!bone) continue;
                const h = new AxesHelper(0.2);
                h.visible = false;
                bone.add(h);
                debugAxesHelpers.push(h);
            }

            // Reset interaction state for the new rig
            gunLHeld = false; gunLWasClose = false;
            gunRHeld = false; gunRWasClose = false;
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
                handL = handR = forearmL = forearmR = upperArmL = upperArmR = gunholdL = gunholdR = gunL = gunR = undefined;
                disposeOld = undefined;
            };

            // Fit camera to model
            // const box = new Box3().setFromObject(root);
            // const center = box.getCenter(new Vector3());
            // const size = box.getSize(new Vector3());
            // const maxDim = Math.max(size.x, size.y, size.z);
            // const fov = camera.fov * (Math.PI / 180);
            // const distance = maxDim / (2 * Math.tan(fov / 2));

            // camera.position.copy(center);
            // camera.position.z += distance * 1.5;
            // camera.near = distance / 100;
            // camera.far = distance * 100;
            // camera.updateProjectionMatrix();
            // camera.lookAt(center);
            // ctrl.target.copy(center);
            // ctrl.update();

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
                    if (gunL && gunholdL && gunR && gunholdR) initGunsPosition();
                    return;
                }
                if (animationPlaying && !(tracker.poseTracker?.detected)) {
                    playNextIdleAnimation();
                }
            });
        }

        // Returns true when the character is facing the camera:
        // both upper-arm bones lie on roughly the same Z plane (XY-aligned).
        function isFacingCamera(): boolean {
            if (!upperArmL || !upperArmR) return false;
            upperArmL.getWorldPosition(_posA);
            upperArmR.getWorldPosition(_posB);
            return Math.abs(_posA.z - _posB.z) < 0.05;
        }

        function updateGunGrab() {
            if (!isFacingCamera()) return;

            // XY-only distance helper (ignores Z depth)
            const dist2D = (a: Vector3, b: Vector3) =>
                Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

            // Left gun: handL ↔ gunholdL
            if (handL && gunholdL && gunL) {
                handL.getWorldPosition(_posA);
                gunholdL.getWorldPosition(_posB);
                const closeL = dist2D(_posA, _posB) < GRAB_THRESHOLD;
                if (closeL && !gunLWasClose) {
                    scene.updateMatrixWorld(true);
                    if (!gunLHeld) {
                        const grabParentL = forearmL ?? handL;
                        grabParentL.attach(gunL);
                        handL.getWorldPosition(_posA);
                        grabParentL.worldToLocal(_posA);
                        gunL.position.set(_posA.x-0.02, _posA.y+0.05, _posA.z+0);
                        gunL.rotation.x += 1;
                        gunL.rotation.y += 0;
                        gunL.rotation.z += 0.3;
                        playOneShot(gunLoadBuffer);
                        gunLHeld = true;
                        if (duelMode) triggerDuelShot();
                    } else if (!duelMode) {
                        gunholdL.add(gunL);
                        gunL.position.copy(gunLRestPos);
                        gunL.quaternion.copy(gunLRestQuat);
                        playOneShot(gunReleaseBuffer);
                        gunLHeld = false;
                    }
                }
                gunLWasClose = closeL;
            }

            // Right gun: handR ↔ gunholdR
            if (handR && gunholdR && gunR) {
                handR.getWorldPosition(_posA);
                gunholdR.getWorldPosition(_posB);
                const closeR = dist2D(_posA, _posB) < GRAB_THRESHOLD;
                if (closeR && !gunRWasClose) {
                    scene.updateMatrixWorld(true);
                    if (!gunRHeld) {
                        const grabParentR = forearmR ?? handR;
                        grabParentR.attach(gunR);
                        handR.getWorldPosition(_posA);
                        grabParentR.worldToLocal(_posA);
                        gunR.position.set(_posA.x, _posA.y+0.05, _posA.z+0);
                        gunR.rotation.x += 1;
                        gunR.rotation.y += 0;
                        gunR.rotation.z += -0.3;
                        playOneShot(gunLoadBuffer);
                        gunRHeld = true;
                        if (duelMode) triggerDuelShot();
                    } else if (!duelMode) {
                        gunholdR.add(gunR);
                        gunR.position.copy(gunRRestPos);
                        gunR.quaternion.copy(gunRRestQuat);
                        playOneShot(gunReleaseBuffer);
                        gunRHeld = false;
                    }
                }
                gunRWasClose = closeR;
            }
        }

        function detectGunGrabDuel() {
            if (duelShootDetected) return;
            const pt = tracker.poseTracker;
            if (!pt) return;

            const dist2D = (a: Vector3, b: Vector3) =>
                Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

            // Left: leftWrist approaching leftLeg (thigh / holster area)
            pt.getNormalizedMarkPosition('leftWrist' as any, _posA);
            pt.getNormalizedMarkPosition('leftLeg' as any, _posB);
            {
                const closeL = dist2D(_posA, _posB) < 0.05;
                console.log('Left wrist→leg:', dist2D(_posA, _posB).toFixed(3), '— close:', closeL);
                if (closeL && !gunLWasClose) {
                    console.log('Shoot L detected !');
                    duelShootDetected = true;
                    triggerDuelShot();
                    return;
                }
                gunLWasClose = closeL;
            }

            // Right: rightWrist approaching rightLeg (thigh / holster area)
            pt.getNormalizedMarkPosition('rightWrist' as any, _posA);
            pt.getNormalizedMarkPosition('rightLeg' as any, _posB);
            {
                const closeR = dist2D(_posA, _posB) < 0.05;
                console.log('Right wrist→leg:', dist2D(_posA, _posB).toFixed(3), '— close:', closeR);
                if (closeR && !gunRWasClose) {
                    console.log('Shoot R detected !');
                    duelShootDetected = true;
                    triggerDuelShot();
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

        function playNextIdleAnimation() {
            if (!mixer || clips.length === 0) return;
            let next = idleAnimIndex === -1 ? clips.map(el => el.name).indexOf("Jump 2") : idleAnimIndex; // idleAnimIndex;
            let excludeClips = ['Idle duel', 'Fall dead', 'Grab fun', 'Stand up', 'Walk']; // clips to exclude from random selection 
            if (clips.length > 1) {
                while (next === idleAnimIndex || excludeClips.includes(clips[next].name)) next = Math.floor(Math.random() * clips.length);
            } else {
                next = 0;
            }
            idleAnimIndex = next;
            currentAction?.stop();
            currentAction = mixer.clipAction(clips[next]);
            currentAction.setLoop(LoopOnce, 1);
            currentAction.clampWhenFinished = true;
            currentAction.reset().play();
            animationPlaying = true;
        }

        function moveToInitialPosition() {
            const direction = new Vector3().subVectors(initialPosition, modelRoot.position);
            const distance = direction.length();
            
            if (distance > 0.025) { // Threshold to prevent jitter
                direction.normalize(); // Normalize the direction vector
                const movement = direction.multiplyScalar(0.025); // Calculate movement
                modelRoot.position.add(movement); // Update character position
            }
        }

        function initGunsPosition() {
            // Set Guns initial position in the holster and parent them to the gunholds
            if (gunholdL && gunL) {
                gunholdL.add(gunL);
                gunL.position.copy(gunLRestPos);
                gunL.quaternion.copy(gunLRestQuat);
                gunLHeld = false;
            }
            if (gunholdR && gunR) {
                gunholdR.add(gunR);
                gunR.position.copy(gunRRestPos);
                gunR.quaternion.copy(gunRRestQuat);
                gunRHeld = false;
            }
        }



        new GLTFLoader().load(DEFAULT_MODEL, (gltf) => { setActiveRig(gltf); onAssetLoaded(); });

        let wasDetected = false;

        let frameCount = 0;

        // — Main update loop —
        return (delta: number) => {
            ctrl.update();

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
                    console.log("Lost detection — Cancel duelMode");
                    duelMode = false;
                    duelCountdown = false;
                    duelGunTriggered = false;
                    currentAction?.stop();
                    currentAction = undefined;
                    animationPlaying = false;
                    if (gunL && gunholdL && gunR && gunholdR) initGunsPosition();
                    idleAnimIndex = -1;
                    playNextIdleAnimation();
                }

                // In duel mode : detect shoot after countdown
                if (! (duelShootDetected || duelCountdown)) {
                    detectGunGrabDuel();
                }

            } else { 
                // - Normal mode -                
                if (!wasDetected && detected && animationPlaying) {
                    // Person re-detected — stop idle animation so tracking takes over
                    currentAction?.stop();
                    currentAction = undefined;
                    animationPlaying = false;
                }

                if (wasDetected && !detected) {
                    // Just lost detection — reset guns and start idle animation chain
                    if (gunL && gunholdL && gunR && gunholdR) initGunsPosition();
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

                 // position character horizontally to follow the detected person
                if (modelRoot) {
                    const hip = tracker.poseTracker!.getNormalizedMarkPosition('hips' as any, _posA);
                    modelRoot.position.x = (hip.x - 0.5) * 2;
                    modelRoot.position.y = Math.max(-0.5, (0.5 - hip.y) * 2); // invert so up = positive
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
