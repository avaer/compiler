import * as THREE from 'three';

//

const localVector = new THREE.Vector3();
const localVector2D = new THREE.Vector2();

//

function bilinearSample(depthData, uv, width, height) {
  let x = uv.x * width;
  let y = uv.y * height;
  
  let x1 = Math.floor(x);
  let y1 = Math.floor(y);

  let x2 = x1 + 1;
  let y2 = y1 + 1;
  
  // Ensure that the sample points are within the data bounds
  x1 = Math.max(0, Math.min(x1, width - 1));
  y1 = Math.max(0, Math.min(y1, height - 1));
  x2 = Math.max(0, Math.min(x2, width - 1));
  y2 = Math.max(0, Math.min(y2, height - 1));
  
  // Get the four sample points
  let q11 = depthData[y1 * width + x1];
  let q21 = depthData[y1 * width + x2];
  let q12 = depthData[y2 * width + x1];
  let q22 = depthData[y2 * width + x2];

  let r1;
  if (x2 === x1) {
    r1 = q11;
  } else {
    r1 = ((x2 - x) / (x2 - x1)) * q11 + ((x - x1) / (x2 - x1)) * q21;
  }

  let r2;
  if (x2 === x1) {
    r2 = q12;
  } else {
    r2 = ((x2 - x) / (x2 - x1)) * q12 + ((x - x1) / (x2 - x1)) * q22;
  }
  if (y2 === y1) {
    return r1;
  } else {
    return ((y2 - y) / (y2 - y1)) * r1 + ((y - y1) / (y2 - y1)) * r2;
  }
}
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export default ctx => {
  const {
    useApp,
    usePhysics,
    usePhysicsTracker,
    // useFloorManager,
    // useSpawnManager,
    // useClients,
    useCleanup,
    useRealmManager,
  } = ctx;

  const app = useApp();
  const physics = usePhysics();
  const physicsTracker = usePhysicsTracker();
  const realmManager = useRealmManager();
  const rootRealm = realmManager.getRootRealm();
  // const floorManager = useFloorManager();
  // const spawnManager = useSpawnManager();
  // const {
  //   blockadelabs: {
  //     loadSkyboxImageSpecs,
  //   },
  // } = useClients();

  const srcUrl = ${this.srcUrl};
  
  ctx.waitUntil((async () => {
    const res = await fetch(srcUrl);
    const json = await res.json();

    const {
      id,
      fileUrl,
      depthMapUrl,
    } = json;
    // console.log('got urls', {
    //   id,
    //   fileUrl,
    //   depthMapUrl,
    // });

    app.worldIdentityId = id;

    // read depth map
    const [
      img,
      {
        width,
        height,
        arrayBuffer,
      },
    ] = await Promise.all([
      (async () => {
        const imgBlob = await (async () => {
          const res = await fetch(fileUrl);
          const blob = await res.blob();
          return blob;
        })();
        const img = await createImageBitmap(imgBlob, {
          imageOrientation: 'flipY',
        });
        return img;
      })(),
      (async () => {
        const res = await fetch(depthMapUrl);
        const blob = await res.blob();
        const imageBitmap = await createImageBitmap(blob);
        const {width, height} = imageBitmap;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmap, 0, 0);

        // read the depth from grey scale
        const imageData = ctx.getImageData(0, 0, width, height);
        const {data} = imageData;
        const arrayBuffer = new ArrayBuffer(width * height * Float32Array.BYTES_PER_ELEMENT);
        const float32Array = new Float32Array(arrayBuffer);
        const depthFactor = 10;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i + 0];
          // const g = data[i + 1];
          // const b = data[i + 2];
          // const a = data[i + 3];
          let rawDepth = r / 255;
          const j = i / 4;
          float32Array[j] = rawDepth * depthFactor;
        }

        return {
          width,
          height,
          arrayBuffer,
        };
      })(),
    ]);

    const imgTexture = new THREE.Texture(img);
    // imgTexture.encoding = THREE.sRGBEncoding;
    imgTexture.needsUpdate = true;

    let float32Array = new Float32Array(arrayBuffer);
    
    const sphereGeometry = new THREE.SphereBufferGeometry(1, 64, 32);
    const positions = sphereGeometry.attributes.position.array;
    const uvs = sphereGeometry.attributes.uv.array;
    const indices = sphereGeometry.index.array;

    // for all points have the same position, make sure they have the same uv
    {
      const positionToOriginalIndexMap = new Map();
      for (let i = 0; i < positions.length / 3; i++) {
        let x = positions[i * 3 + 0];
        let y = positions[i * 3 + 1];
        let z = positions[i * 3 + 2];

        /* // quantize
        const quantum = 0.01;
        if (Math.abs(y) > (1 - quantum)) {
          if (Math.abs(x) < quantum) x = 0;
          if (Math.abs(z) < quantum) z = 0;
          // y = Math.round(y / quantum) * quantum;
        } */

        const key = `${x},${y},${z}`;
        if (positionToOriginalIndexMap.has(key)) {
          const oldIndex = positionToOriginalIndexMap.get(key);
          localVector2D.fromArray(uvs, oldIndex * 2)
            .toArray(uvs, i * 2);
          // debugger;
          // throw new Error('duplicate position');
        } else {
          positionToOriginalIndexMap.set(key, i);
        }
      }
    }

    const min = 0.1;
    const scale = 10;
    const max = 10;

    // support negative values
    function mod(x, y) {
      return x - y * Math.floor(x / y);
    }

    // in JS
    for (let i = 0; i < positions.length / 3; i++) {
      const uv = localVector2D.fromArray(uvs, i * 2);
      uv.x = mod(uv.x, 1)
      uv.y = clamp(1 - uv.y, 0, 1);
      let depth = bilinearSample(float32Array, uv, width, height);
      depth = scale / depth;
      depth = clamp(depth, min * scale, max * scale);
      localVector.fromArray(positions, i * 3)
        .multiplyScalar(depth)
        .toArray(positions, i * 3);
    }
    // reverse triangles
    for (let i = 0; i < indices.length / 3; i++) {
      const a = indices[i * 3 + 0];
      const b = indices[i * 3 + 1];
      const c = indices[i * 3 + 2];
      indices[i * 3 + 0] = c;
      indices[i * 3 + 1] = b;
      indices[i * 3 + 2] = a;
    }
    // const sphereMaterial = new THREE.MeshBasicMaterial({
    //   // color: 0xFFFFFF,
    //   map: imgTexture,
    //   // side: THREE.BackSide,
    // });
    const sphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        map: {
          value: imgTexture,
          needsUpdate: true,
        },
        dynamicDepth: {
          value: 1,
          needsUpdate: true,
        },
      },
      vertexShader: `\
        varying vec2 vUv;
        uniform float dynamicDepth;
        void main() {
          vUv = uv;
          // set the position of the current vertex
          vec3 p = mix(normalize(position) * 20., position * dynamicDepth, dynamicDepth);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `\
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(map, vUv);
        }
      `,
    });
    const octahedronMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
    // this.scene.add(octahedronMesh);
    // octahedronMesh.updateMatrixWorld();
    app.add(octahedronMesh);
    octahedronMesh.updateMatrixWorld();

    // scene physics
    {
      let scenePhysicsObject = null;

      const enablePhysics = () => {
        const scenePhysicsMesh = new THREE.Mesh(
          octahedronMesh.geometry.clone()
            .applyMatrix4(app.matrixWorld),
          octahedronMesh.material
        );
        // scenePhysicsMesh.position.copy(app.position);
        // scenePhysicsMesh.quaternion.copy(app.quaternion);
        // scenePhysicsMesh.scale.copy(app.scale);
        // app.matrixWorld.decompose(
        //   scenePhysicsMesh.position,
        //   scenePhysicsMesh.quaternion,
        //   scenePhysicsMesh.scale
        // );
        // scenePhysicsMesh.updateMatrixWorld();
        // scenePhysicsMesh.matrix.copy(app.matrix);
        // scenePhysicsMesh.matrixWorld.copy(app.matrixWorld);

        scenePhysicsObject = physics.addGeometry(scenePhysicsMesh);
        // scenePhysicsObject.update = () => {
        //   throw new Error('should not be here');
        //   scenePhysicsMesh.matrixWorld.decompose(
        //     scenePhysicsObject.position,
        //     scenePhysicsObject.quaternion,
        //     scenePhysicsObject.scale
        //   );
        //   physics.setTransform(scenePhysicsObject, false);
        // };
        physicsTracker.addAppPhysicsObject(app, scenePhysicsObject);

        // rootRealm.add(
        //   scenePhysicsObject.physicsMesh
        // );
        // scenePhysicsObject.physicsMesh.updateMatrixWorld();
        // scenePhysicsObject.physicsMesh.visible = true;

        // scenePhysicsObject.physicsMesh.onBeforeRender = () => {
        //   console.log('render');
        // };

        // console.log('add physics mesh', rootRealm, scenePhysicsObject.physicsMesh);

        // console.log('enable physics', scenePhysicsObject);
      };
      const disablePhysics = () => {
        // console.log('disable physics', scenePhysicsObject);
        physics.removeGeometry(scenePhysicsObject);
        physicsTracker.removeAppPhysicsObject(app, scenePhysicsObject);
        scenePhysicsObject = null;
      };

      const getPhysicsEnabled = () => app.getComponent('physics') ?? true;
      if (getPhysicsEnabled()) {
        enablePhysics();
      }
      app.addEventListener('componentsupdate', e => {
        const {
          keys,
        } = e;
        // console.log('componentsupdate', keys);
        if (keys.includes('physics')) {
          const physicsEnabled = getPhysicsEnabled();
          // console.log('check physics enabled', physicsEnabled, app);
          if (physicsEnabled && !scenePhysicsObject) {
            // console.log('enable physics', app);
            enablePhysics();
          } else if (!physicsEnabled && scenePhysicsObject) {
            // console.log('disable physics', app);
            disablePhysics();
          }
        }
      });

      useCleanup(() => {
        if (scenePhysicsObject) {
          disablePhysics();
        }
      });
      
      // start off as not selected
      // physics.disableActor(scenePhysicsObject);
      /* app.setSelected = selected => {
        if (selected) {
          // console.log('enable actor', scenePhysicsObject);
          physics.enableActor(scenePhysicsObject);
        } else {
          // console.log('disable actor', scenePhysicsObject);
          physics.disableActor(scenePhysicsObject);
        }
      }; */
    }

    // const raycastResolution = 128;
    // const boundingBox = new THREE.Box3()
    //   .setFromObject(octahedronMesh);
    // const size = boundingBox.getSize(new THREE.Vector3());
    // const getHitMap = () => {
    //   const ps = [];
    //   const qs = [];
    //   for (let h = 0; h < raycastResolution; h++) {
    //     for (let w = 0; w < raycastResolution; w++) {
    //       const p = new THREE.Vector3()
    //         .copy(boundingBox.min)
    //         .add(new THREE.Vector3(
    //           w / raycastResolution * size.x,
    //           0,
    //           h / raycastResolution * size.z
    //         ));
    //       // p.y = boundingBox.max.y + 1;
    //       p.y = 0;
    //       const q = downQuaternion;
    //       ps.push(p);
    //       qs.push(q);
    //     }
    //   }
    //   const hitMap = physics.raycastArray(ps, qs, ps.length);
      
    //   hitMap.coords = Array(hitMap.hit.length);
    //   hitMap.validCoords = new Set();
    //   for (let i = 0; i < hitMap.hit.length; i++) {
    //     const hit = hitMap.hit[i];
    //     if (hit) {
    //       const x = i % raycastResolution;
    //       const y = Math.floor(i / raycastResolution);

    //       let hasAllNeighbors = true;
    //       for (let dx = -5; dx <= 5; dx++) {
    //         for (let dy = -5; dy <= 5; dy++) {
    //           const nx = x + dx;
    //           const ny = y + dy;
    //           if (nx >= 0 && nx < raycastResolution && ny >= 0 && ny < raycastResolution) {
    //             const ni = ny * raycastResolution + nx;
    //             if (!hitMap.hit[ni]) {
    //               hasAllNeighbors = false;
    //               break;
    //             }
    //           }
    //         }
    //       }

    //       const position = new THREE.Vector3().fromArray(hitMap.point, i * 3);
    //       // position.y += 1.5;
    //       hitMap.coords[i] = position;

    //       if (hasAllNeighbors) {
    //         const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * 2 * Math.random());
    //         hitMap.validCoords.add({
    //           position,
    //           quaternion,
    //         });
    //       }
    //     } else {
    //       hitMap.coords[i] = null;
    //     }
    //   }
      
    //   return hitMap;
    // };

    // const makeHitMesh = hitMap => {
    //   // instanced cube mesh
    //   const baseGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    //   const baseMaterial = new THREE.MeshBasicMaterial({
    //     color: 0x0000ff,
    //   });
    //   const instancedMesh = new THREE.InstancedMesh(baseGeometry, baseMaterial, hitMap.hit.length);
    //   instancedMesh.frustumCulled = false;
    //   instancedMesh.name = 'instancedMesh';
    //   instancedMesh.count = 0;

    //   for (let i = 0; i < hitMap.hit.length; i++) {
    //     const hit = hitMap.hit[i];
    //     if (hit) {
    //       const point = new THREE.Vector3().fromArray(hitMap.point, i * 3);
    //       instancedMesh.setMatrixAt(
    //         i,
    //         localMatrix
    //           .makeTranslation(point.x, point.y, point.z)
    //       );
    //     }
    //     instancedMesh.count++;
    //   }
    //   instancedMesh.instanceMatrix.needsUpdate = true;

    //   return instancedMesh;
    // };

    // const hitMap = getHitMap();
    // console.log('got hit map', hitMap);
    // const _listenPortalApp = portalApp => {
    //   const localPlayer = this.playersManager.getLocalPlayer();
    //   let lastPosition = localPlayer.position.clone();
    //   let transitionedLastFrame = false;
    //   const recurse = () => {
    //     frame = requestAnimationFrame(recurse);

    //     const portalPlane = localPlane.setFromNormalAndCoplanarPoint(
    //       localVector.set(0, 0, 1)
    //         .applyQuaternion(portalApp.quaternion),
    //       portalApp.position
    //     );
    //     const lastDistance = portalPlane.distanceToPoint(lastPosition);
    //     const distance = portalPlane.distanceToPoint(localPlayer.position);

    //     if (lastDistance >= 0 && distance < 0) {
    //       // console.log('transition to portal');
    //       // now check whether we passed through the portal bounding square (within 2m of each side)
    //       const projectedPoint = localPlane.projectPoint(localPlayer.position, localVector);
    //       const distanceToCenter = projectedPoint.sub(portalApp.position);
    //       distanceToCenter.x = Math.abs(distanceToCenter.x);
    //       distanceToCenter.y = Math.abs(distanceToCenter.y);
          
    //       // console.log('got distance', distanceToCenter.x, distanceToCenter.y);
    //       if (distanceToCenter.x <= 0.5 && distanceToCenter.y <= 1) {
    //         // move current world into portal
    //         // const rootRealm = this.realmManager.getRootRealm();
    //         // const portalAppManager = portalApp.getAppManager();
    //         // rootRealm.appManager.transplantApp(worldZineApp, portalAppManager);
    //         const oldApps = apps.slice();
    //         // disable old apps
    //         for (let i = 0; i < oldApps.length; i++) {
    //           const oldApp = oldApps[i];
    //           oldApp.setSelected(false);
    //         }

    //         // swap world with portal
    //         const newApps = portalApp.swapApps(oldApps, rootRealm.appManager);
    //         for (let i = 0; i < newApps.length; i++) {
    //           const newApp = newApps[i];
    //           newApp.setSelected(true);
    //         }
    //         apps = newApps;

    //         transitionedLastFrame = true;
    //       }
    //     }

    //     lastPosition.copy(localPlayer.position);
    //     transitionedLastFrame = false;
    //   };
    //   let frame = requestAnimationFrame(recurse);
    // };
    // const _addPortals = async () => {
    //   const numPortals = 1;

    //   const specs = [];
    //   for (let i = 0; i < numPortals; i++) {
    //     const validCoord = Array.from(hitMap.validCoords)[Math.floor(Math.random() * hitMap.validCoords.size)];
    //     const spec = {
    //       validCoord,
    //     };
    //     specs.push(spec);
    //   }

    //   for (let i = 0; i < specs.length; i++) {
    //     const spec = specs[i];
    //     const {
    //       validCoord,
    //     } = spec;
        
    //     let {
    //       position,
    //       quaternion,
    //     } = validCoord;

    //     const rootScene = this.realmManager.getRootRealm();
    //     position = position.clone();
    //     position.y += 1.5;
    //     const portalApp = await rootScene.appManager.addAppAsync({
    //       type: 'application/portal',
    //       position,
    //       quaternion,
    //       content: {
    //         portalContents: [
    //           {
    //             type: 'application/blockadelabsskybox',
    //             content: {
    //               "fileUrl":"/skyboxes/beautiful_vr_anime_illustration_view_red_black_volcanic_plains__f2a9437846594d4c__5662966_f2a94.jpeg_diffuse",
    //               "depthMapUrl":"/skyboxes/beautiful_vr_anime_illustration_view_red_black_volcanic_plains__f2a9437846594d4c__5662966_f2a94.jpeg_depth"
    //             },
    //           },
    //         ],
    //       },
    //     });
    //     _listenPortalApp(portalApp);
    //     console.log('add content portal 2');
    //   }
    // };
    // await _addPortals();

    // const hitMesh = makeHitMesh(hitMap);
    // app.add(hitMesh);
    // hitMesh.updateMatrixWorld();

    // const point = new THREE.Vector3().fromArray(hitMap.point, Math.floor(hitMap.point.length / 3 / 2) * 3);
    // spawnManager.setSpawnPoint(
    //   point,
    //   new THREE.Quaternion(),
    // );
    // await spawnManager.spawn();
  })());

  return app;
};
export const contentId = ${this.contentId};
export const name = ${this.name};
export const description = ${this.description};
export const type = 'blockadelabsskybox';
export const components = ${this.components};