import { rgbaPixels } from "@/modules/terminal/ghostty/images/kittyPixels";
import type { TeraxGhosttyKittyPlacement } from "@terax/ghostty-core/adapted";
import { KITTY_IMAGE_SHADER } from "./shaders";

const RECORD_FLOATS = 12;

type ImageResources = {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly bindGroupLayout: GPUBindGroupLayout;
};
type TextureEntry = {
  readonly generation: number;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly bytes: number;
  binding: GPUBindGroup | null;
  used: boolean;
};
type Pipeline = {
  readonly layout: GPUBindGroupLayout;
  readonly value: GPURenderPipeline;
};
const pipelines = new WeakMap<GPUDevice, Pipeline>();

/** Owns only visible textures; the terminal's image storage remains authoritative. */
export class WebGpuKittyImages {
  private readonly textures = new Map<number, TextureEntry>();
  private draws: TextureEntry[] = [];
  private records = new Float32Array(0);
  private buffer: GPUBuffer | null = null;
  private pipeline: Pipeline | null = null;
  private negativeCount = 0;

  constructor(private readonly resources: ImageResources) {}

  get byteSize(): number {
    let bytes = this.buffer?.size ?? 0;
    for (const entry of this.textures.values()) bytes += entry.bytes;
    return bytes;
  }

  get cpuByteSize(): number {
    return this.records.byteLength;
  }

  update(placements: readonly TeraxGhosttyKittyPlacement[]): boolean {
    if (placements.length === 0) {
      const changed = this.draws.length > 0;
      if (changed) this.dispose();
      return changed;
    }
    const { device } = this.resources;
    this.pipeline ??= this.createPipeline();
    for (const entry of this.textures.values()) entry.used = false;
    const floats = placements.length * RECORD_FLOATS;
    let changed = this.draws.length !== placements.length;
    if (this.records.length < floats) {
      let capacity = RECORD_FLOATS;
      while (capacity < floats) capacity *= 2;
      this.records = new Float32Array(capacity);
      this.buffer?.destroy();
      this.buffer = device.createBuffer({
        label: "Terax Kitty image placements",
        size: capacity * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      for (const entry of this.textures.values()) entry.binding = null;
      changed = true;
    }
    this.negativeCount = 0;
    for (let index = 0; index < placements.length; index++) {
      const p = placements[index];
      const image = p.image;
      let entry = this.textures.get(image.id);
      if (!entry || entry.generation !== image.generation) {
        if (
          image.width > device.limits.maxTextureDimension2D ||
          image.height > device.limits.maxTextureDimension2D
        ) {
          throw new RangeError("Kitty image exceeds the GPU texture limit");
        }
        const pixels = rgbaPixels(image);
        entry?.texture.destroy();
        const texture = device.createTexture({
          label: "Terax Kitty image",
          size: [image.width, image.height],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        device.queue.writeTexture(
          { texture },
          pixels as Uint8Array<ArrayBuffer>,
          { bytesPerRow: image.width * 4, rowsPerImage: image.height },
          [image.width, image.height],
        );
        entry = {
          generation: image.generation,
          texture,
          view: texture.createView(),
          bytes: image.width * image.height * 4,
          binding: null,
          used: true,
        };
        this.textures.set(image.id, entry);
        changed = true;
      }
      entry.used = true;
      if (!entry.binding) {
        entry.binding = device.createBindGroup({
          label: "Terax Kitty image bindings",
          layout: this.pipeline.layout,
          entries: [
            { binding: 0, resource: { buffer: this.buffer as GPUBuffer } },
            { binding: 1, resource: entry.view },
          ],
        });
      }
      if (this.draws[index] !== entry) changed = true;
      this.draws[index] = entry;
      if (p.z < 0) this.negativeCount++;
      const offset = index * RECORD_FLOATS;
      changed = this.store(offset, p.x) || changed;
      changed = this.store(offset + 1, p.y) || changed;
      changed = this.store(offset + 2, p.width) || changed;
      changed = this.store(offset + 3, p.height) || changed;
      changed = this.store(offset + 4, p.sourceX) || changed;
      changed = this.store(offset + 5, p.sourceY) || changed;
      changed = this.store(offset + 6, p.sourceWidth) || changed;
      changed = this.store(offset + 7, p.sourceHeight) || changed;
      changed =
        this.store(offset + 8, p.z < -1_073_741_824 ? -2 : p.z < 0 ? -1 : 1) ||
        changed;
    }
    this.draws.length = placements.length;
    for (const [id, entry] of this.textures) {
      if (entry.used) continue;
      entry.texture.destroy();
      this.textures.delete(id);
    }
    if (changed && this.buffer) {
      device.queue.writeBuffer(this.buffer, 0, this.records, 0, floats);
    }
    return changed;
  }

  draw(pass: GPURenderPassEncoder, aboveText: boolean): void {
    if (!this.pipeline) return;
    const first = aboveText ? this.negativeCount : 0;
    const end = aboveText ? this.draws.length : this.negativeCount;
    if (first === end) return;
    pass.setPipeline(this.pipeline.value);
    for (let index = first; index < end; index++) {
      const entry = this.draws[index];
      if (!entry.binding) continue;
      pass.setBindGroup(1, entry.binding);
      pass.draw(6, 1, 0, index);
    }
  }

  dispose(): void {
    for (const entry of this.textures.values()) entry.texture.destroy();
    this.textures.clear();
    this.buffer?.destroy();
    this.buffer = null;
    this.records = new Float32Array(0);
    this.draws = [];
    this.negativeCount = 0;
    this.pipeline = null;
  }

  private store(index: number, value: number): boolean {
    const next = Math.fround(value);
    if (this.records[index] === next) return false;
    this.records[index] = next;
    return true;
  }

  private createPipeline(): Pipeline {
    const { device, format, bindGroupLayout } = this.resources;
    const cached = pipelines.get(device);
    if (cached) return cached;
    const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const layout = device.createBindGroupLayout({
      label: "Terax Kitty image layout",
      entries: [
        { binding: 0, visibility, buffer: { type: "read-only-storage" } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
      ],
    });
    const module = device.createShaderModule({
      label: "Terax Kitty image shader",
      code: KITTY_IMAGE_SHADER,
    });
    const value = device.createRenderPipeline({
      label: "Terax Kitty image pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout, layout],
      }),
      vertex: { module, entryPoint: "image_vertex" },
      fragment: {
        module,
        entryPoint: "image_fragment",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    const pipeline = { layout, value };
    pipelines.set(device, pipeline);
    return pipeline;
  }
}
