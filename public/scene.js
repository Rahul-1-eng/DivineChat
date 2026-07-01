import * as THREE from 'three';

const container = document.getElementById('scene-container');

// 1. CORE SCENE
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.FogExp2(0x0a0a0a, 0.04);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

// 2. THE AVATAR (The Green Capsule)
const avatarGeometry = new THREE.CapsuleGeometry(0.5, 1.2, 4, 16);
const avatarMaterial = new THREE.MeshStandardMaterial({ color: 0x10a37f, roughness: 0.2, metalness: 0.8 });
const avatar = new THREE.Mesh(avatarGeometry, avatarMaterial);
avatar.position.y = 1.2;
scene.add(avatar);

// 3. DYNAMIC 3D TERRAIN (The Morphing Floor)
const floorGeo = new THREE.PlaneGeometry(40, 40, 40, 40);
const floorMat = new THREE.MeshStandardMaterial({ 
    color: 0x006699, 
    wireframe: true, // Set to true so you can easily see the waves moving!
    roughness: 0.1,
    transparent: true,
    opacity: 0.6
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
scene.add(floor);

// 4. THE PARTICLES
const particleCount = 1500;
const particlesGeometry = new THREE.BufferGeometry();
const particlesPositions = new Float32Array(particleCount * 3);
for(let i = 0; i < particleCount * 3; i++) {
    particlesPositions[i] = (Math.random() - 0.5) * 20; 
}
particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlesPositions, 3));
const particlesMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.6 });
const particles = new THREE.Points(particlesGeometry, particlesMaterial);
scene.add(particles);

// 5. STATE & TRANSITIONS
let currentAnimation = 'idle';
let currentEnv = 'space';
const targetBgColor = new THREE.Color(0x0a0a0a);
const targetFogColor = new THREE.Color(0x0a0a0a);
const targetFloorColor = new THREE.Color(0x000000);
let particleSpeed = 0.02;

// 6. THE BRIDGE
window.addEventListener('updateScene', (e) => {
    const data = e.detail;
    changeEnvironment(data.environment);
    currentAnimation = data.animation || 'idle';
});

// 7. THE DIRECTOR LOGIC
function changeEnvironment(preset) {
    currentEnv = preset;
    const envMap = {
        'space':      { bg: 0x020205, fog: 0x020205, pColor: 0xffffff, speed: 0.005, fColor: 0x000000, wire: false, showFloor: false },
        'forest':     { bg: 0x051408, fog: 0x051408, pColor: 0x44aa44, speed: 0.01, fColor: 0x0a2a0a, wire: false, showFloor: true },
        'rain-city':  { bg: 0x0a0a1a, fog: 0x0a0a1a, pColor: 0x88aaff, speed: 0.2, fColor: 0xff00a0, wire: true, showFloor: true },
        'beach':      { bg: 0x2a1a10, fog: 0x2a1a10, pColor: 0xffccaa, speed: 0.01, fColor: 0x0088ff, wire: true, showFloor: true },
        'snow':       { bg: 0x1a1a20, fog: 0xeeeeff, pColor: 0xffffff, speed: 0.04, fColor: 0xffffff, wire: false, showFloor: true },
        'underwater': { bg: 0x001122, fog: 0x001133, pColor: 0x4488ff, speed: -0.03, fColor: 0x002244, wire: true, showFloor: true },
        'fire':       { bg: 0x220000, fog: 0x330000, pColor: 0xff4400, speed: -0.06, fColor: 0x660000, wire: true, showFloor: true },
        'clouds':     { bg: 0x112233, fog: 0x88aabb, pColor: 0xffffff, speed: 0.005, fColor: 0xffffff, wire: false, showFloor: false }
    };

    const config = envMap[preset] || envMap['space']; 
    
    targetBgColor.setHex(config.bg);
    targetFogColor.setHex(config.fog);
    targetFloorColor.setHex(config.fColor);
    particlesMaterial.color.setHex(config.pColor);
    particleSpeed = config.speed;
    
    floor.visible = config.showFloor;
    floorMat.wireframe = config.wire;
    
    avatarMaterial.color.setHex(preset === 'fire' ? 0xff3333 : 0x10a37f);
}

// 8. THE ANIMATION LOOP
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // Smooth Color Fades
    scene.background.lerp(targetBgColor, 0.02);
    scene.fog.color.lerp(targetFogColor, 0.02);
    floorMat.color.lerp(targetFloorColor, 0.02);

    // Capsule Animations
    if (currentAnimation === 'idle') {
        avatar.position.y = 1.2 + Math.sin(time * 2) * 0.1; 
        avatar.rotation.y = Math.sin(time * 0.5) * 0.2;
    } else if (currentAnimation === 'talk') {
        avatar.position.y = 1.2 + Math.sin(time * 10) * 0.05; 
        avatar.rotation.y = Math.sin(time * 3) * 0.3;
    } else if (currentAnimation === 'wave' || currentAnimation === 'laugh') {
        avatar.position.y = 1.2 + Math.abs(Math.sin(time * 8)) * 0.4; 
        avatar.rotation.y += 0.05; 
    } else {
        avatar.position.y = 1.2;
    }

    // FULLY ANIMATED MORPHING TERRAIN
    if (floor.visible) {
        const positions = floorGeo.attributes.position.array;
        for(let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i+1]; 
            
            if (currentEnv === 'beach' || currentEnv === 'underwater') {
                // Rolling ocean waves
                positions[i+2] = Math.sin(x * 0.5 + time) * 0.3 + Math.cos(y * 0.5 + time) * 0.3;
            } else if (currentEnv === 'forest' || currentEnv === 'snow') {
                // Bumpy hills
                positions[i+2] = Math.sin(x * 0.3) * 0.5 + Math.cos(y * 0.3) * 0.5;
            } else if (currentEnv === 'rain-city' || currentEnv === 'fire') {
                // Glitching grids
                positions[i+2] = Math.random() * 0.3;
            } else {
                positions[i+2] = 0;
            }
        }
        floorGeo.attributes.position.needsUpdate = true;
    }

    // Particles
    const pPositions = particlesGeometry.attributes.position.array;
    for(let i = 1; i < particleCount * 3; i += 3) { 
        pPositions[i] -= particleSpeed; 
        if(pPositions[i] < -10) pPositions[i] = 10;
        if(pPositions[i] > 10) pPositions[i] = -10;
    }
    particlesGeometry.attributes.position.needsUpdate = true;
    
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});