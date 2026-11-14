import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { AtmospherePass } from './gfx/AtmospherePass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: .62 },
    uGrain: { value: .038 },
    uChroma: { value: 1.0 },
    uFlash: { value: 0 },
    uDamage: { value: 0 },
    uSat: { value: 1.05 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Color(0x0a141c) },
    uBoost: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uChroma, uFlash, uDamage, uSat, uContrast, uBoost;
    uniform vec2 uRes;
    uniform vec3 uLift;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 p = vUv - 0.5;
      float r2 = dot(p,p);
      float ab = (0.0015 + uDamage*0.010 + uBoost*0.004) * uChroma * (0.25 + r2*2.4);
      vec2 off = normalize(p + 1e-6) * ab;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      vec3 shadowTint = vec3(0.86,0.98,1.12);
      vec3 highTint   = vec3(1.10,1.01,0.90);
      c *= mix(shadowTint, highTint, smoothstep(0.12,0.85,l));
      c += uLift * (1.0 - smoothstep(0.0,0.35,l)) * 0.35;
      float gray = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(gray), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c = max(c, vec3(0.0));
      float vig = 1.0 - uVignette * smoothstep(0.18,0.78,r2);
      c *= vig;
      c = mix(c, vec3(0.75,0.055,0.025), uDamage * smoothstep(0.12,0.55,r2) * 0.55);
      c += vec3(1.0,0.92,0.82) * uFlash;
      float g = hash(vUv*uRes + fract(uTime)*173.13) - 0.5;
      c += g * uGrain * (0.45 + (1.0-l)*0.8);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 2) {
    this.renderer = renderer;
    this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(size.x * pr)), h = Math.max(1, Math.floor(size.y * pr));
    // Depth texture attached to the composer buffers → AO / god rays / DOF in one pass.
    const depth = new THREE.DepthTexture(w, h);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth, samples: 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.atmo = new AtmospherePass(camera, w, h);
    this.composer.addPass(this.atmo);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), .48, .68, .86);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.setSize(size.x, size.y, pr);
    this.setQuality(quality);
    this._sunDir = new THREE.Vector3(0, 1, 0);
  }

  setSize(w, h, pr = 1) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    const ew = Math.max(1, Math.floor(w * pr)), eh = Math.max(1, Math.floor(h * pr));
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.depthTexture) {
        rt.depthTexture.image.width = ew;
        rt.depthTexture.image.height = eh;
        rt.depthTexture.needsUpdate = true;
      }
    }
    this.fxaa.material.uniforms.resolution.value.set(1 / ew, 1 / eh);
    this.grade.material.uniforms.uRes.value.set(ew, eh);
    this.atmo.setSize(ew, eh);
  }

  setQuality(q) {
    this.quality = q;
    this.bloom.enabled = q >= 1;
    this.bloom.strength = q >= 3 ? .58 : q >= 2 ? .46 : .26;
    this.atmo.enabled = q >= 1;
    this.atmo.uniforms.uAOSamples.value = q >= 3 ? 12 : q >= 2 ? 9 : 5;
    this.atmo.uniforms.uRaySamples.value = q >= 3 ? 24 : q >= 2 ? 18 : 10;
    this.atmo.uniforms.uAO.value = q >= 2 ? .9 : .55;
    this.atmo.uniforms.uShafts.value = q >= 2 ? .38 : .2;
    this.grade.material.uniforms.uGrain.value = q >= 2 ? .038 : .022;
  }

  updateFrame(t, camera, sunDir, opts = {}) {
    const u = this.atmo.uniforms;
    if (sunDir) {
      this._sunDir.copy(sunDir);
      camera.updateMatrixWorld();
      this.atmo.setSun(this._sunDir, camera, opts.sunIntensity ?? 1);
    }
    u.uTime.value = t;
    u.uDOF.value = THREE.MathUtils.lerp(u.uDOF.value, opts.dof ?? 0, .18);
    u.uFocus.value = opts.focus ?? 40;
    u.uFocusRange.value = opts.focusRange ?? 22;
    u.uSunColor.value.setRGB(...(opts.sunColor || [1, .7, .38]));
    const g = this.grade.material.uniforms;
    g.uTime.value = t;
    g.uDamage.value = THREE.MathUtils.lerp(g.uDamage.value, opts.damage ?? 0, .18);
    g.uFlash.value = opts.flash ?? 0;
    g.uBoost.value = opts.boost ?? 0;
    this.composer.render(opts.dt ?? 1 / 60);
  }

  /** Compatibility shim for the legacy main-loop call signature. */
  render(dt, t, damage = 0, flash = 0) {
    this.updateFrame(t, this.camera, this._sunDir, { damage, flash, dt });
  }
}
