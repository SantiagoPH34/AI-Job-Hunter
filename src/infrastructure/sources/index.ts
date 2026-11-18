import type { JobSourcePort } from "../../domain/ports/JobSourcePort.js";
import { AdzunaSource } from "./AdzunaSource.js";
import { ArbeitnowSource } from "./ArbeitnowSource.js";
import { GetOnBoardSource } from "./GetOnBoardSource.js";
import { HimalayasSource } from "./HimalayasSource.js";
import { JobicySource } from "./JobicySource.js";
import { JoobleSource } from "./JoobleSource.js";
import { JSearchSource } from "./JSearchSource.js";
import { RemoteOkSource } from "./RemoteOkSource.js";
import { RemotiveSource } from "./RemotiveSource.js";
import { WeWorkRemotelySource } from "./WeWorkRemotelySource.js";

export function createJobSources(): JobSourcePort[] {
  return [
    new GetOnBoardSource(),
    new RemotiveSource(),
    new RemoteOkSource(),
    new WeWorkRemotelySource(),
    new JobicySource(),
    new HimalayasSource(),
    new ArbeitnowSource(),
    new JSearchSource(),
    new AdzunaSource(),
    new JoobleSource(),
  ];
}
