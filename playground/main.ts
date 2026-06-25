import * as THREE from "three/webgpu";
import { setupTracker } from "lucky-luke-duel";
import { DemoHandler } from "./demo-type";
import { luckyLukeDemo } from "./lucky-luke-demo";

// — Renderer —
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
 renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.5;
document.body.appendChild(renderer.domElement);
renderer.shadowMap.enabled = true;

const demo: DemoHandler = luckyLukeDemo;

await Promise.all([renderer.init(), setupTracker(demo.trackerConfig)]).then(
    ([renderer, tracker]) => {
        // — Scene —
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xFFFFFF); 

        // — Camera —
        const camera = new THREE.PerspectiveCamera(
            65,
            window.innerWidth / window.innerHeight,
            0.1,
            100,
        );
        camera.position.set(0, 1, 1);
        camera.lookAt(0, 1, 3);  

		// — Handle resize —
        window.addEventListener("resize", () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

		//-----------
		// Sources : hidden from UI
		// const sourceBtn = document.createElement("button"); 
		// sourceBtn.onclick = () => {
		// 	window.open(`https://github.com/bandinopla/lucky-luke-duel/blob/main/playground/${demo.name}.ts`,"_blank");
		// };
		// sourceBtn.classList.add("source-btn");
		// sourceBtn.textContent = "</>";
		// document.body.appendChild(sourceBtn);
 

        // — Lights —
        // const ambient = new THREE.AmbientLight(0xffffff, 0.1);
        // scene.add(ambient);

        // const directional = new THREE.DirectionalLight(0xffffff, 2);
        // directional.position.set(17, 10, 17);
		// directional.castShadow = true;
		// directional.shadow.mapSize.width = 2048/2;
		// directional.shadow.mapSize.height = 2048/2;
		// directional.shadow.camera.near = 0.5;
		// directional.shadow.camera.far = 110;
		// directional.shadow.camera.left = -10;
		// directional.shadow.camera.right = 10;
		// directional.shadow.camera.top = 10;
		// directional.shadow.camera.bottom = -10;
		// directional.shadow.bias = -0.0003;
        // scene.add(directional);

		const demoHandler = demo.setup(renderer, camera, scene, tracker);

		let clock = new THREE.Timer() 

		renderer.setAnimationLoop((time:number) => { 
			 
			const delta = clock.update(time).getDelta();  
			
			if(demoHandler?.(delta)===void 0)
				renderer.render(scene, camera);
		}) 
		
    },
);
