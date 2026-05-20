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
} from "three/webgpu";

import { GLTFLoader, OrbitControls } from "three/examples/jsm/Addons.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Inspector } from "three/examples/jsm/inspector/Inspector.js";
import { DemoHandler } from "./demo-type";
import { RecordableBindingHandler, TrackerHandler } from "lucky-luke-duel";

const DEFAULT_MODEL = import.meta.env.BASE_URL +  "Lucky-Luke-simplified.glb";
const GRAB_THRESHOLD = 0.1; // world-unit proximity to trigger grab/release
const infosEl = document.getElementById("infos")!;

export const luckyLukeDemo: DemoHandler = {
    name: "lucky-luke-demo",
    trackerConfig: {
        displayScale: 0.75,
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

        scene.add(new AxesHelper(1));

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

        scene.add( new SpotLightHelper( spotLight, 10 ) );
        


        // Floor plane
        const floorMat = new MeshPhongMaterial( {
					color: 0xffffff,
					shininess: 150,
					specular: 0x111111
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
        modelPanel.add(shadowOpt, "castShadow").name("Cast shadow").onChange((v: boolean) => {
            modelRoot?.traverse((child: Object3D) => {
                if (child instanceof Mesh) child.castShadow = v;
            });
        });
        modelPanel.add({
            logCamera: () => {
                console.log("Camera position:", camera.position.toArray().map(n => +n.toFixed(3)));
                console.log("Camera lookAt (target):", ctrl.target.toArray().map(n => +n.toFixed(3)));
                console.log("Camera look direction:", camera.getWorldDirection(new Vector3()).toArray().map(n => +n.toFixed(3)));
                console.log("Camera rotation (deg):", [camera.rotation.x, camera.rotation.y, camera.rotation.z].map(r => +(r * 180 / Math.PI).toFixed(1)));
            }
        }, "logCamera").name("Log camera");

        // — Animations —

        let mixer: AnimationMixer | undefined;
        let clips: AnimationClip[] = [];
        let currentAction: AnimationAction | undefined;
        let animationPlaying = false;
        const animState = { clip: "" };

        const animPanel = inspector.createParameters("Animations");
        // new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "animations.glb")
        new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "animations.glb")
            .then((gltf) => {
                clips = gltf.animations;
                if (clips.length === 0) return;
                animState.clip = clips[0].name;
                animPanel.add(animState, "clip", clips.map((c) => c.name)).name("Animation");
                animPanel.add({ toggle: toggleAnimation }, "toggle").name("Play / Stop");
            })
            .catch((err) => console.warn("Could not load animations.glb:", err));

        // — Audio —

        let berimbauBuffer: AudioBuffer | undefined;
        let berimbauPlaying = false;
        let audioCtx: AudioContext | undefined;

        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "Duel.mp3")
            .then((buf) => { berimbauBuffer = buf; })
            .catch((err) => console.warn("Could not load Duel.mp3:", err));

        let gunLoadBuffer: AudioBuffer | undefined;
        let gunReleaseBuffer: AudioBuffer | undefined;
        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "GunLoad.mp3")
            .then((buf) => { gunLoadBuffer = buf; })
            .catch((err) => console.warn("Could not load GunLoad.mp3:", err));
        new AudioLoader().loadAsync(import.meta.env.BASE_URL + "GunRelease.mp3")
            .then((buf) => { gunReleaseBuffer = buf; })
            .catch((err) => console.warn("Could not load GunRelease.mp3:", err));

        function playOneShot(buf: AudioBuffer | undefined) {
            if (!buf) return;
            if (!audioCtx) audioCtx = new AudioContext();
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(audioCtx.destination);
            src.start(0);
        }

        function playBerimbau() {
            console.log("Play berimbau!");
            if (!berimbauBuffer || berimbauPlaying) return;
            if (!audioCtx) audioCtx = new AudioContext();
            berimbauPlaying = true;
            const source = audioCtx.createBufferSource();
            source.buffer = berimbauBuffer;
            source.connect(audioCtx.destination);
            source.onended = () => { berimbauPlaying = false; };
            source.start(0);
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
        let eyeR: Object3D | undefined;
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

        // Hands-above-eye rising-edge state
        let handsAboveEyeWas = false;

        // Reusable vectors for update loop
        const _posA = new Vector3();
        const _posB = new Vector3();
        const _posC = new Vector3();

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
            eyeR      = root.getObjectByName("eyeR");
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
            handsAboveEyeWas = false;

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
                handL = handR = forearmL = forearmR = upperArmL = upperArmR = gunholdL = gunholdR = eyeR = gunL = gunR = undefined;
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
                        infosEl.textContent = "Gun L: HELD";
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
                    } else {
                        infosEl.textContent = "Gun L: RELEASED";
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
                        infosEl.textContent = "Gun R: HELD";
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
                    } else {
                        infosEl.textContent = "Gun R: RELEASED";
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

        function updateBerimbau() {
            if (!eyeR || !handL || !handR) return;
            eyeR.getWorldPosition(_posC);
            handL.getWorldPosition(_posA);
            handR.getWorldPosition(_posB);
            const handsAbove = _posA.y > _posC.y && _posB.y > _posC.y;
            if (handsAbove && !handsAboveEyeWas) playBerimbau();
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
            let next = idleAnimIndex;
            if (clips.length > 1) {
                while (next === idleAnimIndex) next = Math.floor(Math.random() * clips.length);
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



        new GLTFLoader().load(DEFAULT_MODEL, setActiveRig);

        let wasDetected = false;

        return (delta: number) => {
            ctrl.update();

            const detected = tracker.poseTracker?.detected ?? false;

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

            wasDetected = detected;

            if (animationPlaying && mixer) {
                mixer.update(delta);
            } else if (detected) {
                lukeBind?.update(delta);
                updateGunGrab();
                updateBerimbau();
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
