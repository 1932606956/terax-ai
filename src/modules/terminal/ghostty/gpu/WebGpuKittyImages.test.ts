import { describe, expect, it, vi, type Mock } from "vitest";
import type { TeraxGhosttyKittyPlacement } from "@terax/ghostty-core/adapted";
import { WebGpuKittyImages } from "./WebGpuKittyImages";

function harness() {
  vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, COPY_DST: 2 });
  vi.stubGlobal("GPUBufferUsage", { STORAGE: 1, COPY_DST: 2 });
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2 });
  const textures: { destroy: Mock }[] = [];
  const queue = { writeTexture: vi.fn(), writeBuffer: vi.fn() };
  const device = {
    queue,
    limits: { maxTextureDimension2D: 8192 },
    createTexture: vi.fn(() => {
      const texture = { createView: () => ({}), destroy: vi.fn() };
      textures.push(texture);
      return texture;
    }),
    createBuffer: vi.fn(({ size }: { size: number }) => ({ size, destroy: vi.fn() })),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
  } as unknown as GPUDevice;
  const resources = { device, format: "bgra8unorm" as const, bindGroupLayout: {} as GPUBindGroupLayout };
  return { renderer: new WebGpuKittyImages(resources), device, queue, textures };
}

const image = { id: 1, generation: 1, width: 1, height: 1, format: 4 as const, data: Uint8Array.of(255, 0, 0, 255) };
const placement: TeraxGhosttyKittyPlacement = { image, x: 0, y: 0, z: -1, width: 10, height: 20, sourceX: 0, sourceY: 0, sourceWidth: 1, sourceHeight: 1 };

describe("WebGPU Kitty image ownership", () => {
  it("allocates nothing until an image appears", () => {
    const h = harness();
    expect(h.renderer.update([])).toBe(false);
    expect(h.device.createTexture).not.toHaveBeenCalled();
    expect(h.device.createBuffer).not.toHaveBeenCalled();
    h.renderer.dispose();
    vi.unstubAllGlobals();
  });

  it("uploads a shared image once, reuses stationary frames and changes geometry without reuploading pixels", () => {
    const h = harness();
    const pair = [placement, { ...placement, x: 10 }];
    expect(h.renderer.update(pair)).toBe(true);
    expect(h.queue.writeTexture).toHaveBeenCalledOnce();
    expect(h.renderer.update(pair.map((p) => ({ ...p })))).toBe(false);
    expect(h.queue.writeTexture).toHaveBeenCalledOnce();
    expect(h.renderer.update([{ ...placement, y: -10 }])).toBe(true);
    expect(h.queue.writeTexture).toHaveBeenCalledOnce();
    h.renderer.dispose();
    vi.unstubAllGlobals();
  });

  it("replaces equal-size images by generation and releases textures on deletion", () => {
    const h = harness();
    h.renderer.update([placement]);
    h.renderer.update([{ ...placement, image: { ...image, generation: 2, data: Uint8Array.of(0, 0, 255, 255) } }]);
    expect(h.queue.writeTexture).toHaveBeenCalledTimes(2);
    expect(h.textures[0].destroy).toHaveBeenCalledOnce();
    expect(h.renderer.update([])).toBe(true);
    expect(h.textures[1].destroy).toHaveBeenCalledOnce();
    h.renderer.dispose();
    vi.unstubAllGlobals();
  });
});
