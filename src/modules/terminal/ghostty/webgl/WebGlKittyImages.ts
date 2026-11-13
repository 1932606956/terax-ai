/**
 * Kitty placements for the WebGL fallback. GPU resources exist only after the
 * first image. Textures are keyed by image id and generation, uploaded from a
 * copy of the borrowed pixels, and deleted when a placement disappears or the
 * renderer resets, loses its context, or is disposed.
 */

import { rgbaPixels } from "@/modules/terminal/ghostty/images/kittyPixels";
import type {
  TeraxGhosttyKittyImage,
  TeraxGhosttyKittyPlacement,
} from "@terax/ghostty-core/adapted";

/** Placements strictly below this sit under non-default cell backgrounds. */
const BELOW_CELLS = -1_073_741_824;
const PLACEMENT_FLOATS = 8;

export const KITTY_IMAGE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_unitquad;
layout(location = 1) in vec4 a_destination;
layout(location = 2) in vec4 a_source;
uniform vec2 u_resolution;
out vec2 v_texcoord;
void main() {
  vec2 pixel = a_destination.xy + a_unitquad * a_destination.zw;
  gl_Position = vec4(
    pixel.x / u_resolution.x * 2.0 - 1.0,
    1.0 - pixel.y / u_resolution.y * 2.0,
    0.0,
    1.0
  );
  v_texcoord = a_source.xy + a_unitquad * a_source.zw;
}`;

export const KITTY_IMAGE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_image;
in vec2 v_texcoord;
out vec4 outColor;
void main() {
  outColor = texture(u_image, v_texcoord);
}`;

type ImageProgram = {
  readonly value: WebGLProgram;
  readonly resolution: WebGLUniformLocation;
  readonly image: WebGLUniformLocation;
};

type CachedImage = {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly generation: number;
  seen: boolean;
};

type ClippedPlacement = {
  readonly placement: TeraxGhosttyKittyPlacement;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
};

export type WebGlKittyImageLayer = "below-cells" | "below-text" | "above-text";

export type WebGlKittyImageStats = {
  readonly images: number;
  readonly placements: number;
  readonly uploads: number;
  readonly gpuBytes: number;
  readonly cpuBytes: number;
};

export class WebGlKittyImages {
  private program: ImageProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private elementBuffer: WebGLBuffer | null = null;
  private attributeBuffer: WebGLBuffer | null = null;
  private readonly images = new Map<string, CachedImage>();
  private readonly runs: Record<WebGlKittyImageLayer, PreparedRun[]> = {
    "below-cells": [],
    "below-text": [],
    "above-text": [],
  };
  private placementCount = 0;
  private uploadCount = 0;
  private gpuBytes = 0;
  private cpuBytes = 0;
  private signature = "";
  private active = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /**
   * Uploads images whose generation changed and rebuilds clipped quads.
   * Borrowed WASM views are converted and uploaded here; nothing retains them.
   * Returns whether the visible placements changed.
   */
  sync(
    placements: readonly TeraxGhosttyKittyPlacement[],
    gridWidth: number,
    gridHeight: number,
  ): boolean {
    if (!this.active && placements.length === 0) return false;
    const signature = placementSignature(placements, gridWidth, gridHeight);
    if (signature === this.signature) {
      for (const image of this.images.values()) image.seen = true;
      return false;
    }
    this.ensureResources();
    for (const image of this.images.values()) image.seen = false;
    const pending: Record<WebGlKittyImageLayer, PendingRun[]> = {
      "below-cells": [],
      "below-text": [],
      "above-text": [],
    };
    let count = 0;
    const uploaded = new Set<string>();
    for (const placement of placements) {
      const clipped = clipPlacement(placement, gridWidth, gridHeight);
      if (!clipped) continue;
      const key = imageKey(placement.image);
      if (!uploaded.has(key)) {
        this.retainImage(placement.image);
        uploaded.add(key);
      } else {
        const cached = this.images.get(key);
        if (cached) cached.seen = true;
      }
      const layerRuns = pending[placementLayer(placement.z)];
      const current = layerRuns[layerRuns.length - 1];
      if (current?.key === key) current.quads.push(clipped);
      else layerRuns.push({ key, quads: [clipped] });
      count += 1;
    }
    this.cpuBytes = 0;
    for (const layer of LAYERS) {
      const prepared: PreparedRun[] = [];
      for (const run of pending[layer]) {
        const quads = new Float32Array(run.quads.length * PLACEMENT_FLOATS);
        for (let index = 0; index < run.quads.length; index += 1) {
          writeQuad(quads, index * PLACEMENT_FLOATS, run.quads[index]);
        }
        this.cpuBytes += quads.byteLength;
        prepared.push({ key: run.key, quads });
      }
      this.runs[layer] = prepared;
    }
    this.dropUnseen();
    this.placementCount = count;
    this.signature = signature;
    return true;
  }

  draw(layer: WebGlKittyImageLayer, width: number, height: number): void {
    const program = this.program;
    const vao = this.vao;
    const buffer = this.attributeBuffer;
    const runs = this.runs[layer];
    if (!this.active || !program || !vao || !buffer || runs.length === 0)
      return;
    const gl = this.gl;
    const blending = gl.isEnabled(gl.BLEND);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
    gl.useProgram(program.value);
    gl.bindVertexArray(vao);
    gl.uniform2f(program.resolution, width, height);
    gl.activeTexture(gl.TEXTURE2);
    gl.uniform1i(program.image, 2);
    for (const run of runs) {
      const cached = this.images.get(run.key);
      if (run.quads.length === 0 || !cached) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, run.quads, gl.DYNAMIC_DRAW);
      gl.bindTexture(gl.TEXTURE_2D, cached.texture);
      gl.drawElementsInstanced(
        gl.TRIANGLE_STRIP,
        4,
        gl.UNSIGNED_BYTE,
        0,
        run.quads.length / PLACEMENT_FLOATS,
      );
    }
    if (!blending) gl.disable(gl.BLEND);
  }

  /** Deletes textures and the image program. Invalid after the context is lost. */
  reset(): void {
    this.releaseGpu(true);
  }

  /** Forgets GPU objects without touching a lost context. */
  abandon(): void {
    this.releaseGpu(false);
  }

  dispose(): void {
    this.releaseGpu(true);
  }

  hasLayer(layer: WebGlKittyImageLayer): boolean {
    return this.runs[layer].length > 0;
  }
  stats(): WebGlKittyImageStats {
    return {
      images: this.images.size,
      placements: this.placementCount,
      uploads: this.uploadCount,
      gpuBytes: this.active ? this.gpuBytes : 0,
      cpuBytes: this.active ? this.cpuBytes : 0,
    };
  }

  private retainImage(image: TeraxGhosttyKittyImage): void {
    const key = imageKey(image);
    const cached = this.images.get(key);
    if (cached && cached.generation === image.generation) {
      cached.seen = true;
      return;
    }
    if (cached) this.deleteImage(key, cached);
    const pixels = rgbaPixels(image);
    const texture = this.uploadTexture(pixels, image.width, image.height);
    this.images.set(key, {
      texture,
      generation: image.generation,
      width: image.width,
      height: image.height,
      seen: true,
    });
    this.uploadCount += 1;
    this.gpuBytes += image.width * image.height * 4;
  }

  private uploadTexture(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to allocate a Kitty image texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    return texture;
  }

  private dropUnseen(): void {
    for (const [key, cached] of this.images) {
      if (!cached.seen) this.deleteImage(key, cached);
    }
  }

  private deleteImage(key: string, cached: CachedImage): void {
    this.gl.deleteTexture(cached.texture);
    this.gpuBytes -= cached.width * cached.height * 4;
    this.images.delete(key);
  }

  private ensureResources(): void {
    if (this.active) return;
    const gl = this.gl;
    const programValue = createProgram(
      gl,
      KITTY_IMAGE_VERTEX_SHADER,
      KITTY_IMAGE_FRAGMENT_SHADER,
    );
    this.program = {
      value: programValue,
      resolution: requiredUniform(gl, programValue, "u_resolution"),
      image: requiredUniform(gl, programValue, "u_image"),
    };
    this.quadBuffer = requiredBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.elementBuffer = requiredBuffer(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.elementBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint8Array([0, 1, 2, 3]),
      gl.STATIC_DRAW,
    );
    this.attributeBuffer = requiredBuffer(gl);
    this.vao = requiredVertexArray(gl);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.elementBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.attributeBuffer);
    enablePlacementAttribute(gl, 1, 4, 0);
    enablePlacementAttribute(gl, 2, 4, 4);
    this.active = true;
  }

  private releaseGpu(deleteObjects: boolean): void {
    if (!this.active && this.images.size === 0) {
      this.signature = "";
      this.placementCount = 0;
      return;
    }
    if (deleteObjects) {
      const gl = this.gl;
      for (const cached of this.images.values())
        gl.deleteTexture(cached.texture);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.elementBuffer) gl.deleteBuffer(this.elementBuffer);
      if (this.attributeBuffer) gl.deleteBuffer(this.attributeBuffer);
      if (this.program) gl.deleteProgram(this.program.value);
    }
    this.images.clear();
    this.program = null;
    this.vao = null;
    this.quadBuffer = null;
    this.elementBuffer = null;
    this.attributeBuffer = null;
    this.runs["below-cells"] = [];
    this.runs["below-text"] = [];
    this.runs["above-text"] = [];
    this.placementCount = 0;
    this.gpuBytes = 0;
    this.cpuBytes = 0;
    this.signature = "";
    this.active = false;
  }
}

const LAYERS: readonly WebGlKittyImageLayer[] = [
  "below-cells",
  "below-text",
  "above-text",
];

type PendingRun = { key: string; quads: ClippedPlacement[] };
type PreparedRun = { readonly key: string; readonly quads: Float32Array };

export function placementLayer(z: number): WebGlKittyImageLayer {
  if (z < BELOW_CELLS) return "below-cells";
  if (z < 0) return "below-text";
  return "above-text";
}

/**
 * Intersects a placement with the grid viewport and scales its source crop by
 * the same fraction. Y grows downward from the top of the grid.
 */
export function clipPlacement(
  placement: TeraxGhosttyKittyPlacement,
  gridWidth: number,
  gridHeight: number,
): ClippedPlacement | null {
  const { image } = placement;
  if (
    placement.width <= 0 ||
    placement.height <= 0 ||
    placement.sourceWidth <= 0 ||
    placement.sourceHeight <= 0 ||
    image.width <= 0 ||
    image.height <= 0 ||
    gridWidth <= 0 ||
    gridHeight <= 0
  ) {
    return null;
  }
  let { x, y, width, height } = placement;
  let { sourceX, sourceY, sourceWidth, sourceHeight } = placement;
  if (x < 0) {
    const fraction = -x / width;
    sourceX += sourceWidth * fraction;
    sourceWidth *= 1 - fraction;
    width += x;
    x = 0;
  }
  if (y < 0) {
    const fraction = -y / height;
    sourceY += sourceHeight * fraction;
    sourceHeight *= 1 - fraction;
    height += y;
    y = 0;
  }
  if (x + width > gridWidth) {
    const fraction = Math.max(0, (gridWidth - x) / width);
    sourceWidth *= fraction;
    width = Math.max(0, gridWidth - x);
  }
  if (y + height > gridHeight) {
    const fraction = Math.max(0, (gridHeight - y) / height);
    sourceHeight *= fraction;
    height = Math.max(0, gridHeight - y);
  }
  if (sourceX < 0) {
    sourceWidth += sourceX;
    sourceX = 0;
  }
  if (sourceY < 0) {
    sourceHeight += sourceY;
    sourceY = 0;
  }
  sourceWidth = Math.min(sourceWidth, image.width - sourceX);
  sourceHeight = Math.min(sourceHeight, image.height - sourceY);
  if (width <= 0 || height <= 0 || sourceWidth <= 0 || sourceHeight <= 0)
    return null;
  return {
    placement,
    x,
    y,
    width,
    height,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  };
}

function writeQuad(
  target: Float32Array,
  offset: number,
  clipped: ClippedPlacement,
): void {
  const { image } = clipped.placement;
  target[offset] = clipped.x;
  target[offset + 1] = clipped.y;
  target[offset + 2] = clipped.width;
  target[offset + 3] = clipped.height;
  target[offset + 4] = clipped.sourceX / image.width;
  target[offset + 5] = clipped.sourceY / image.height;
  target[offset + 6] = clipped.sourceWidth / image.width;
  target[offset + 7] = clipped.sourceHeight / image.height;
}

function placementSignature(
  placements: readonly TeraxGhosttyKittyPlacement[],
  gridWidth: number,
  gridHeight: number,
): string {
  let signature = `${gridWidth}x${gridHeight}`;
  for (const placement of placements) {
    const { image } = placement;
    signature += `|${image.id}:${image.generation}:${image.width}x${image.height}:${placement.x},${placement.y},${placement.z},${placement.width}x${placement.height},${placement.sourceX},${placement.sourceY},${placement.sourceWidth}x${placement.sourceHeight}`;
  }
  return signature;
}

function imageKey(image: TeraxGhosttyKittyImage): string {
  return `${image.id}:${image.generation}`;
}

function enablePlacementAttribute(
  gl: WebGL2RenderingContext,
  location: number,
  size: number,
  offset: number,
): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    PLACEMENT_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    offset * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.vertexAttribDivisor(location, 1);
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to allocate a Kitty image program");
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Failed to link the Kitty image program: ${detail}`);
  }
  return program;
}

function createShader(
  gl: WebGL2RenderingContext,
  kind: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error("Failed to allocate a Kitty image shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || "unknown compile error";
    gl.deleteShader(shader);
    throw new Error(`Failed to compile a Kitty image shader: ${detail}`);
  }
  return shader;
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Missing Kitty image uniform ${name}`);
  return location;
}

function requiredBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Failed to allocate a Kitty image buffer");
  return buffer;
}

function requiredVertexArray(
  gl: WebGL2RenderingContext,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to allocate a Kitty image vertex array");
  return vao;
}
