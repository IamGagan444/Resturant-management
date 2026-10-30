import { describe, expect, it } from "vitest";
import { $Enums } from "@prisma/client";
import * as C from "@rms/contracts";

// Contracts mirror Prisma enums so browser bundles never import @prisma/client. This catches drift.
const pairs = [
  ["StaffRole", $Enums.StaffRole, C.StaffRole],
  ["HotelStatus", $Enums.HotelStatus, C.HotelStatus],
  ["TableStatus", $Enums.TableStatus, C.TableStatus],
  ["SessionStatus", $Enums.SessionStatus, C.SessionStatus],
  ["OrderSource", $Enums.OrderSource, C.OrderSource],
  ["OrderStatus", $Enums.OrderStatus, C.OrderStatus],
  ["ItemStatus", $Enums.ItemStatus, C.ItemStatus],
  ["FoodType", $Enums.FoodType, C.FoodType],
  ["RequestType", $Enums.RequestType, C.RequestType],
  ["RequestStatus", $Enums.RequestStatus, C.RequestStatus],
  ["BillStatus", $Enums.BillStatus, C.BillStatus],
  ["SplitType", $Enums.SplitType, C.SplitType],
  ["PaymentMethod", $Enums.PaymentMethod, C.PaymentMethod],
  ["PaymentStatus", $Enums.PaymentStatus, C.PaymentStatus],
  ["DeviceKind", $Enums.DeviceKind, C.DeviceKind],
] as const;

describe("contracts enums match Prisma", () => {
  it.each(pairs)("%s", (_name, prisma, contract) => {
    expect([...contract.options].sort()).toEqual(Object.values(prisma).sort());
  });
});
