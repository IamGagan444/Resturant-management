import { describe, expect, it } from "vitest";
import { scopeArgs, TenantContextMissingError, TenantMismatchError, withTenant, currentHotelId } from "./tenant";

const H = "hotel_a";

describe("scopeArgs", () => {
  it("adds hotelId to reads", () => {
    expect(scopeArgs("Order", "findMany", { where: { status: "PLACED" } }, H)).toEqual({
      where: { status: "PLACED", hotelId: H },
    });
    expect(scopeArgs("Order", "findUnique", { where: { id: "o1" } }, H).where).toEqual({ id: "o1", hotelId: H });
    expect(scopeArgs("Order", "count", undefined, H).where).toEqual({ hotelId: H });
  });

  it("stamps hotelId on creates, including createMany arrays", () => {
    expect(scopeArgs("Floor", "create", { data: { name: "Ground" } }, H).data).toEqual({ name: "Ground", hotelId: H });
    expect(scopeArgs("Floor", "createMany", { data: [{ name: "A" }, { name: "B" }] }, H).data).toEqual([
      { name: "A", hotelId: H },
      { name: "B", hotelId: H },
    ]);
  });

  it("scopes upsert where and create", () => {
    const a = scopeArgs("Customer", "upsert", { where: { id: "c" }, create: { phone: "1" }, update: {} }, H);
    expect(a.where).toEqual({ id: "c", hotelId: H });
    expect(a.create).toEqual({ phone: "1", hotelId: H });
  });

  it("rejects foreign hotelId in where, create and update", () => {
    expect(() => scopeArgs("Order", "findMany", { where: { hotelId: "hotel_b" } }, H)).toThrow(TenantMismatchError);
    expect(() => scopeArgs("Floor", "create", { data: { hotelId: "hotel_b", name: "x" } }, H)).toThrow(
      TenantMismatchError,
    );
    expect(() => scopeArgs("Floor", "update", { where: { id: "f" }, data: { hotelId: "hotel_b" } }, H)).toThrow(
      TenantMismatchError,
    );
  });

  it("rejects relation-style hotel input", () => {
    expect(() => scopeArgs("Floor", "create", { data: { name: "x", hotel: { connect: { id: H } } } }, H)).toThrow();
  });

  it("throws without tenant context", () => {
    expect(() => scopeArgs("Order", "findMany", {}, undefined)).toThrow(TenantContextMissingError);
  });

  it("leaves non-tenant models alone", () => {
    expect(scopeArgs("Hotel", "findMany", { where: { slug: "x" } }, undefined)).toEqual({ where: { slug: "x" } });
    expect(scopeArgs("PlatformUser", "findUnique", { where: { email: "a" } }, undefined)).toEqual({
      where: { email: "a" },
    });
  });
});

describe("withTenant", () => {
  it("propagates through async boundaries and isolates concurrent contexts", async () => {
    const seen = await Promise.all(
      ["h1", "h2", "h3"].map((h) =>
        withTenant(h, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return currentHotelId();
        }),
      ),
    );
    expect(seen).toEqual(["h1", "h2", "h3"]);
    expect(currentHotelId()).toBeUndefined();
  });
});
