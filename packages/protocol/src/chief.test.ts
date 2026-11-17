import { describe, expect, it } from "vitest";
import { CHIEF_ROLE_LABEL_KEY, CHIEF_ROLE_LABEL_VALUE, hasChiefRoleLabel } from "./chief.js";

describe("Chief role label", () => {
  it("is paseo.role=chief, defined in one place", () => {
    expect(CHIEF_ROLE_LABEL_KEY).toBe("paseo.role");
    expect(CHIEF_ROLE_LABEL_VALUE).toBe("chief");
  });

  it("matches only that exact label", () => {
    expect(hasChiefRoleLabel({ "paseo.role": "chief" })).toBe(true);
    expect(hasChiefRoleLabel({ "paseo.role": "Chief" })).toBe(false);
    expect(hasChiefRoleLabel({ "paseo.role": "worker" })).toBe(false);
    expect(hasChiefRoleLabel({ role: "chief" })).toBe(false);
    expect(hasChiefRoleLabel({})).toBe(false);
    expect(hasChiefRoleLabel(null)).toBe(false);
    expect(hasChiefRoleLabel(undefined)).toBe(false);
  });
});
