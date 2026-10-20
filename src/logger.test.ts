/**
 * Tests for logger module
 */

import { expect } from "@std/expect";
import { describe, it } from "node:test";
import { createLogger, getLoggerOptions, logger } from "./logger.ts";

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

  describe("getLoggerOptions", () => {
    it("should return JSON format options by default", () => {
      const options = getLoggerOptions("json", "info", "UTC");
      expect(options.level).toBe("info");
      expect(options.transport).toBeUndefined();
      expect(options.base).toEqual({ service: "sharriff" });
      expect(typeof options.timestamp).toBe("function");
      expect(typeof options.formatters?.level).toBe("function");
    });

    it("should return pretty format options with UTC timezone", () => {
      const options = getLoggerOptions("pretty", "debug", "UTC");
      expect(options.level).toBe("debug");
      expect(options.transport).toMatchObject({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "UTC:yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
          singleLine: false,
        },
      });
    });

    it("should return pretty format options with SYS timezone", () => {
      const options = getLoggerOptions("pretty", "info", "Europe/Berlin");
      expect(options.transport).toMatchObject({
        options: {
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
        },
      });
    });

    it("should format level labels as objects", () => {
      const options = getLoggerOptions("json", "info", "UTC");
      const formatter = options.formatters?.level as (label: string) => unknown;
      expect(formatter("info")).toEqual({ level: "info" });
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
