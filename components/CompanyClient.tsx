"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import PageHeader from "./PageHeader";
import { useDashboard } from "@/lib/configStore";
import { REGIONS, STATUS_LABEL } from "@/lib/types";
import { SiteRow } from "./site/siteData";

interface Company {
  id: number;
  name: string;
  memo: string | null;
  devices: number;
  users: number;
}

/** 고객사 등록·수정과 설비 배정. 등록·배정은 DH 관리자, 조회는 DH 직원 모두. */
export default function CompanyClient({ canEdit }: { canEdit: boolean }) {
  const { devices, refresh } = useDashboard();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", memo: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ name: "", memo: "" });
  const [openId, setOpenId] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteForm, setSiteForm] = useState({ name: "", region: "" });
  const [siteEdit, setSiteEdit] = useState<{ id: number; name: string; region: string } | null>(null);

  async function loadSites() {
    const res = await fetch("/api/sites", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setSites(json.sites ?? []);
  }

  useEffect(() => {
    void loadSites();
  }, []);

  async function addSite(companyId: number) {
    if (await call("/api/sites", "POST", { ...siteForm, company_id: companyId })) {
      setNotice({ ok: true, text: `${siteForm.name} 사업장을 등록했습니다.` });
      setSiteForm({ name: "", region: "" });
      await loadSites();
    }
  }

  async function saveSite() {
    if (siteEdit && (await call("/api/sites", "PATCH", siteEdit))) {
      setSiteEdit(null);
      await Promise.all([loadSites(), refresh()]);
    }
  }

  async function removeSite(id: number, name: string) {
    if (await call(`/api/sites?id=${id}`, "DELETE")) {
      setNotice({ ok: true, text: `${name} 사업장을 삭제했습니다.` });
      await loadSites();
    }
  }

  async function patchDevice(deviceId: string, patch: Record<string, unknown>) {
    if (await call("/api/devices", "PATCH", { device_id: deviceId, ...patch })) {
      await Promise.all([loadSites(), refresh()]);
    }
  }

  async function load() {
    const res = await fetch("/api/admin/companies", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setCompanies(json.companies ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  const unassigned = useMemo(() => devices.filter((d) => !d.company_id), [devices]);

  async function call(url: string, method: string, body?: unknown) {
    setNotice(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setNotice({ ok: false, text: json.error ?? "처리하지 못했습니다." });
    return res.ok;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call("/api/admin/companies", "POST", form)) {
      setNotice({ ok: true, text: `${form.name} 고객사를 등록했습니다.` });
      setForm({ name: "", memo: "" });
      await load();
    }
  }

  async function saveEdit(id: number) {
    if (await call("/api/admin/companies", "PATCH", { id, ...edit })) {
      setEditId(null);
      await Promise.all([load(), refresh()]);
    }
  }

  async function remove(c: Company) {
    if (await call(`/api/admin/companies?id=${c.id}`, "DELETE")) {
      setNotice({ ok: true, text: `${c.name} 고객사를 삭제했습니다.` });
      await load();
    }
  }

  async function assign(deviceId: string, companyId: number | null) {
    if (await call("/api/devices", "PATCH", { device_id: deviceId, company_id: companyId, site_id: null })) {
      setPick("");
      await Promise.all([load(), refresh()]);
    }
  }

  return (
    <>
      <PageHeader
        title="고객사 관리"
        breadcrumb="DH 운영 › 고객사 관리"
        subtitle={`고객사 ${companies.length}곳 · 미배정 설비 ${unassigned.length}대`}
      />

      {notice && <div className={`banner ${notice.ok ? "ok" : "error"}`}>{notice.text}</div>}

      {canEdit && (
        <form className="filterbar" onSubmit={add}>
          <span className="filter-label">고객사명</span>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <span className="filter-label">메모</span>
          <input
            className="field"
            style={{ minWidth: 280 }}
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
          <div className="filterbar-right">
            <button className="btn primary" type="submit" disabled={!form.name.trim()}>
              고객사 추가
            </button>
          </div>
        </form>
      )}

      <div className="card flush">
        <div className="card-head">
          <div className="card-title">
            <span className="accent-bar" />
            고객사 목록
          </div>
          <span className="card-note">{companies.length}곳</span>
        </div>
        <div className="table-wrap">
          <table className="fixed fit">
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 340 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              {canEdit && <col style={{ width: 150 }} />}
            </colgroup>
            <thead>
              <tr>
                <th>No</th>
                <th>고객사</th>
                <th>메모</th>
                <th>설비</th>
                <th>담당자</th>
                {canEdit && <th>동작</th>}
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && (
                <tr>
                  <td className="empty" colSpan={canEdit ? 6 : 5}>조회된 데이터가 없습니다.</td>
                </tr>
              )}
              {companies.map((c, i) => {
                const open = openId === c.id;
                const mine = devices.filter((d) => d.company_id === c.id);
                return (
                  <Fragment key={c.id}>
                    <tr className={`clickable${open ? " selected" : ""}`} onClick={() => setOpenId(open ? null : c.id)}>
                      <td className="center">{i + 1}</td>
                      <td>
                        {editId === c.id ? (
                          <input
                            className="field"
                            value={edit.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                          />
                        ) : (
                          <b>{c.name}</b>
                        )}
                      </td>
                      <td>
                        {editId === c.id ? (
                          <input
                            className="field"
                            value={edit.memo}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEdit({ ...edit, memo: e.target.value })}
                          />
                        ) : (
                          c.memo ?? "-"
                        )}
                      </td>
                      <td className="num">{c.devices}대</td>
                      <td className="num">{c.users}명</td>
                      {canEdit && (
                        <td className="center" onClick={(e) => e.stopPropagation()}>
                          {editId === c.id ? (
                            <span className="pw-edit">
                              <button className="btn sm primary" onClick={() => void saveEdit(c.id)} disabled={!edit.name.trim()}>
                                저장
                              </button>
                              <button className="btn sm" onClick={() => setEditId(null)}>
                                취소
                              </button>
                            </span>
                          ) : (
                            <span className="pw-edit">
                              <button
                                className="btn sm"
                                onClick={() => {
                                  setEditId(c.id);
                                  setEdit({ name: c.name, memo: c.memo ?? "" });
                                }}
                              >
                                수정
                              </button>
                              <button
                                className="btn sm"
                                disabled={c.devices > 0 || c.users > 0}
                                title={c.devices > 0 || c.users > 0 ? "연결된 설비·담당자가 있습니다" : undefined}
                                onClick={() => void remove(c)}
                              >
                                삭제
                              </button>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={canEdit ? 6 : 5}>
                          <div className="spark-title">{`사업장 ${sites.filter((x) => x.company_id === c.id).length}곳`}</div>
                          <table className="fixed fit sub-table">
                            <colgroup>
                              <col style={{ width: 220 }} />
                              <col style={{ width: 110 }} />
                              <col style={{ width: 80 }} />
                              {canEdit && <col style={{ width: 130 }} />}
                            </colgroup>
                            <thead>
                              <tr>
                                <th>사업장</th>
                                <th>권역</th>
                                <th>설비</th>
                                {canEdit && <th>동작</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {sites.filter((x) => x.company_id === c.id).length === 0 && (
                                <tr>
                                  <td className="empty" colSpan={canEdit ? 4 : 3}>조회된 데이터가 없습니다.</td>
                                </tr>
                              )}
                              {sites
                                .filter((x) => x.company_id === c.id)
                                .map((st) => (
                                  <tr key={st.id}>
                                    <td>
                                      {siteEdit?.id === st.id ? (
                                        <input
                                          className="field"
                                          aria-label="사업장명"
                                          value={siteEdit.name}
                                          onChange={(e) => setSiteEdit({ ...siteEdit, name: e.target.value })}
                                        />
                                      ) : (
                                        <b>{st.name}</b>
                                      )}
                                    </td>
                                    <td className="center">
                                      {siteEdit?.id === st.id ? (
                                        <select
                                          className="field"
                                          aria-label="권역"
                                          value={siteEdit.region}
                                          onChange={(e) => setSiteEdit({ ...siteEdit, region: e.target.value })}
                                        >
                                          <option value="">미지정</option>
                                          {REGIONS.map((r) => (
                                            <option key={r} value={r}>
                                              {r}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        st.region || "-"
                                      )}
                                    </td>
                                    <td className="num">{`${st.devices}대`}</td>
                                    {canEdit && (
                                      <td className="center">
                                        {siteEdit?.id === st.id ? (
                                          <span className="pw-edit">
                                            <button className="btn sm primary" disabled={!siteEdit.name.trim()} onClick={() => void saveSite()}>
                                              저장
                                            </button>
                                            <button className="btn sm" onClick={() => setSiteEdit(null)}>
                                              취소
                                            </button>
                                          </span>
                                        ) : (
                                          <span className="pw-edit">
                                            <button className="btn sm" onClick={() => setSiteEdit({ id: st.id, name: st.name, region: st.region })}>
                                              수정
                                            </button>
                                            <button className="btn sm" disabled={st.devices > 0} onClick={() => void removeSite(st.id, st.name)}>
                                              삭제
                                            </button>
                                          </span>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {canEdit && (
                            <div className="pw-edit">
                              <input
                                className="field"
                                aria-label="새 사업장명"
                                placeholder="사업장명"
                                value={siteForm.name}
                                onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                              />
                              <select
                                className="field"
                                aria-label="권역"
                                value={siteForm.region}
                                onChange={(e) => setSiteForm({ ...siteForm, region: e.target.value })}
                              >
                                <option value="">권역 선택</option>
                                {REGIONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                              <button className="btn sm primary" disabled={!siteForm.name.trim()} onClick={() => void addSite(c.id)}>
                                사업장 추가
                              </button>
                            </div>
                          )}

                          <div className="spark-title">{`배정 설비 ${mine.length}대`}</div>
                          <table className="fixed fit sub-table">
                            <colgroup>
                              <col style={{ width: 130 }} />
                              <col style={{ width: 200 }} />
                              <col style={{ width: 90 }} />
                              <col style={{ width: 170 }} />
                              <col style={{ width: 110 }} />
                              <col style={{ width: 80 }} />
                              {canEdit && <col style={{ width: 90 }} />}
                            </colgroup>
                            <thead>
                              <tr>
                                <th>설비</th>
                                <th>사업장</th>
                                <th>형식</th>
                                <th>설치 장소</th>
                                <th>용량</th>
                                <th>상태</th>
                                {canEdit && <th>배정 해제</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {mine.length === 0 && (
                                <tr>
                                  <td className="empty" colSpan={canEdit ? 7 : 6}>조회된 데이터가 없습니다.</td>
                                </tr>
                              )}
                              {mine.map((d) => (
                                <tr key={d.device_id}>
                                  <td><b>{d.name}</b></td>
                                  <td>
                                    {canEdit ? (
                                      <select
                                        className="field"
                                        aria-label="사업장"
                                        value={d.site_id ?? ""}
                                        onChange={(e) => void patchDevice(d.device_id, { site_id: e.target.value || null })}
                                      >
                                        <option value="">미지정</option>
                                        {sites
                                          .filter((x) => x.company_id === c.id)
                                          .map((x) => (
                                            <option key={x.id} value={x.id}>
                                              {x.name}
                                            </option>
                                          ))}
                                      </select>
                                    ) : (
                                      d.site_name ?? "-"
                                    )}
                                  </td>
                                  <td className="center">
                                    {canEdit ? (
                                      <select
                                        className="field"
                                        aria-label="형식"
                                        value={d.model ?? "4형"}
                                        onChange={(e) => void patchDevice(d.device_id, { model: e.target.value })}
                                      >
                                        <option value="3형">3형</option>
                                        <option value="4형">4형</option>
                                      </select>
                                    ) : (
                                      d.model ?? "4형"
                                    )}
                                  </td>
                                  <td>
                                    {canEdit ? (
                                      <input
                                        className="field"
                                        aria-label="설치 장소"
                                        defaultValue={d.place ?? ""}
                                        placeholder={d.building || "예: 제1전기실"}
                                        onBlur={(e) => {
                                          if (e.target.value !== (d.place ?? "")) void patchDevice(d.device_id, { place: e.target.value });
                                        }}
                                      />
                                    ) : (
                                      d.place || d.building || "-"
                                    )}
                                  </td>
                                  <td>{d.capacity}</td>
                                  <td className="center">
                                    <span className={`badge ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                                  </td>
                                  {canEdit && (
                                    <td className="center">
                                      <button className="btn sm" onClick={() => void assign(d.device_id, null)}>
                                        해제
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {canEdit && unassigned.length > 0 && (
                            <div className="pw-edit">
                              <select className="field" value={pick} onChange={(e) => setPick(e.target.value)}>
                                <option value="">미배정 설비 선택</option>
                                {unassigned.map((d) => (
                                  <option key={d.device_id} value={d.device_id}>
                                    {d.name} ({d.building})
                                  </option>
                                ))}
                              </select>
                              <button className="btn sm primary" disabled={!pick} onClick={() => void assign(pick, c.id)}>
                                배정
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
