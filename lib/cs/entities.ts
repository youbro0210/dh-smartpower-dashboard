import type { SafeFields } from "@/cs-engine/policy";
import type { FieldKind } from "@/cs-engine/fields";

/**
 * 데이터 정정으로 고칠 수 있는 칸입니다. 여기에 없는 칸은 정정안이 와도 막힙니다.
 *
 * 계측값·알람 이력·임계치·장비 명령·수집 설정·계정·알림 받는 곳(target)은 일부러 넣지 않았습니다.
 * 잘못 고치면 변압기 이상을 놓치거나 기록의 근거가 사라지므로 화면에서 사람이 처리합니다.
 */
export interface CsEntity {
  label: string;
  table: string;
  idColumn: string;
  idKind: "int" | "text";
  fields: Record<string, { label: string; kind: FieldKind; nullable?: boolean }>;
  /** 정정안에 보여 줄 이름. $1 은 id 입니다. */
  describe: string;
}

export const ENTITIES: Record<string, CsEntity> = {
  maintenance: {
    label: "점검 이력",
    table: "maintenance_logs",
    idColumn: "id",
    idKind: "int",
    fields: {
      work_date: { label: "작업일", kind: "date" },
      next_due: { label: "다음 점검일", kind: "date", nullable: true },
      title: { label: "작업 내용", kind: "text" },
      detail: { label: "상세", kind: "text", nullable: true },
      worker: { label: "작업자", kind: "text", nullable: true },
    },
    describe: `SELECT unit || ' · ' || to_char(work_date, 'YYYY-MM-DD') AS d FROM maintenance_logs WHERE id = $1`,
  },
  device: {
    label: "설비",
    table: "devices",
    idColumn: "device_id",
    idKind: "text",
    fields: {
      name: { label: "설비명", kind: "text" },
      building: { label: "건물", kind: "text" },
      capacity: { label: "용량", kind: "text" },
    },
    describe: `SELECT name AS d FROM devices WHERE device_id = $1`,
  },
  recipient: {
    label: "알림 수신자",
    table: "notify_recipients",
    idColumn: "id",
    idKind: "int",
    fields: {
      name: { label: "이름", kind: "text" },
      memo: { label: "메모", kind: "text", nullable: true },
    },
    describe: `SELECT name AS d FROM notify_recipients WHERE id = $1`,
  },
};

/**
 * 위험 낮음일 때 사람 확인 없이 바로 반영하는 칸입니다.
 * 판정·날짜에 닿지 않는 글 칸만 둡니다. 설비명·건물·용량은 현장이 설비를 찾는 근거이므로 관리자가 반영합니다.
 */
export const AUTO_FIELDS: SafeFields = {
  maintenance: ["title", "detail", "worker"],
  recipient: ["memo"],
};
