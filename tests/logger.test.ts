/**
 * Tests for logger module
 */

import { describe, it } from "node:test";
import { expect } from "@std/expect";
import { createLogger, logger } from "../src/logger.ts";

describe("Logger", () => {
  describe("logger singleton", () => {
    it("should expose pino logging methods", () => {
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.trace).toBe("function");
      expect(typeof logger.fatal).toBe("function");
    });

    it("should have a valid log level", () => {
      expect(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).toContain(
        logger.level,
      );
    });
  });

  describe("createLogger", () => {
    it("should return a child logger with the given context", () => {
      const child = createLogger({ instance: "radarr" });
      expect(typeof child.info).toBe("function");
      expect(typeof child.warn).toBe("function");
      expect(typeof child.error).toBe("function");
      expect(typeof child.debug).toBe("function");
    });

    it("should bind the context to the child logger", () => {
      const child = createLogger({ instance: "sonarr", component: "test" });
      const bindings = child.bindings();
      expect(bindings.instance).toBe("sonarr");
      expect(bindings.component).toBe("test");
    });

    it("should return distinct children for different contexts", () => {
      const childA = createLogger({ instance: "radarr" });
      const childB = createLogger({ instance: "sonarr" });
      expect(childA.bindings().instance).toBe("radarr");
      expect(childB.bindings().instance).toBe("sonarr");
    });
  });
});
