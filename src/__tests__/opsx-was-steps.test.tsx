// src/__tests__/opsx-was-steps.test.tsx - OpsX WAS adimlarinin DAVRANISI.
//
// src/__tests__/opsx-was-single-select.test.cjs kaynak metnini kilitler; bu dosya ayni
// kurallarin ekranda GERCEKTEN boyle calistigini olcer (render + tiklama):
//   V1 JVM secimi radyo + TEK secim; OLCULEMEDI satiri secilemez ve "Durmus" gosterilmez
//   V2 islem dugmeleri olculen duruma gore acilir (RUNNING: Durdur/Restart, Baslat kapali)
//   V3 "Geri" ile donuste (resume) YENI kesif isi acilmaz
//   V4 onay: JVM adi birebir + onay kutusu; yapistirma engellenir; uyari varsa ayrica kabul
//   V5 sonuc paneli: OLCULEMEDI sari "gercek durum bilinmiyor", olculmemis once/sonra "—"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, render } from "@testing-library/react";
import WasJvmSelectStep from "@/components/opsx/steps/WasJvmSelectStep";
import WasConfirmStep from "@/components/opsx/steps/WasConfirmStep";
import WasResultPanel from "@/components/opsx/steps/WasResultPanel";
import type { WasTarget, WasRunStatus } from "@/api/opsxApi";

const mockDiscover = vi.hoisted(() => vi.fn());
const mockDiscoverStatus = vi.hoisted(() => vi.fn());

vi.mock("@/api/opsxApi", () => ({
  opsxWasApi: {
    discover: mockDiscover,
    discoverStatus: mockDiscoverStatus,
  },
}));

function target(over: Partial<WasTarget> = {}): WasTarget {
  return {
    host: "GBWASP01",
    profile: "AppSrv01",
    cell: "CELL01",
    node: "NODE01",
    server: "APPX",
    cluster: "CL_APPX",
    state: "RUNNING",
    pids: 1,
    ss: "UP",
    reason: "",
    kimlik: "var",
    hostOverall: "ok",
    selectable: true,
    allowedOps: ["stop", "restart"],
    peers: { total: 1, running: 1, unknown: 0 },
    warnings: { stop: [], restart: [], start: [] },
    ...over,
  };
}

const HOST_INFO = [
  { host: "GBWASP01", env: "Production", envRaw: "PROD", os: "LINUX", wasVersion: "9.0.5", status: "running", selectable: true, reason: "" },
  { host: "GBWASP02", env: "Production", envRaw: "PROD", os: "LINUX", wasVersion: "9.0.5", status: "running", selectable: true, reason: "" },
];

function statusWith(targets: WasTarget[]) {
  const now = Date.now();
  return {
    ok: true,
    status: "successful",
    app: "APPX",
    hosts: [
      { host: "GBWASP01", overall: "ok", reason: "", hasApp: true },
      { host: "GBWASP02", overall: "ok", reason: "", hasApp: true },
    ],
    targets,
    finishedAt: new Date(now - 60_000).toISOString(),
    validUntil: new Date(now + 14 * 60_000).toISOString(),
    appLock: null,
  };
}

beforeEach(() => {
  mockDiscover.mockResolvedValue({ ok: true, jobId: 501, awxServerId: 1, status: "pending", hosts: ["GBWASP01", "GBWASP02"] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WasJvmSelectStep", () => {
  it("V1 radyo + TEK secim; OLCULEMEDI satiri secilemez ve Durmus gosterilmez", async () => {
    mockDiscoverStatus.mockResolvedValue(
      statusWith([
        target(),
        target({
          host: "GBWASP02",
          cell: "CELL02",
          node: "NODE02",
          state: "OLCULEMEDI",
          pids: -1,
          ss: "?",
          reason: "serverStatus yanitsiz",
          selectable: false,
          allowedOps: [],
        }),
      ]),
    );
    const onSubmit = vi.fn();
    render(<WasJvmSelectStep app="APPX" hostInfo={HOST_INFO} onSubmit={onSubmit} />);

    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText(/tümünü/i)).toBeNull();
    expect(mockDiscover).toHaveBeenCalledTimes(1);
    expect(mockDiscover).toHaveBeenCalledWith("APPX", undefined);

    // Olculemeyen satir: radyo kapali, sari "Ölçülemedi" rozeti, "Durmuş" YOK.
    expect(radios[1]).toBeDisabled();
    expect(screen.getByText("Ölçülemedi")).toBeInTheDocument();
    expect(screen.queryByText("Durmuş")).toBeNull();
    expect(screen.getByText(/Durum ölçülemedi — gerçek durum bilinmiyor/)).toBeInTheDocument();

    // (Devre disi radyoya tiklama jsdom'da DOM'u yine de isaretliyor; tarayicida olmaz.
    // Tek secim davranisi iki SECILEBILIR satirla V2'de olculur.)
    fireEvent.click(radios[0]);
    expect(radios[0]).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Durdur" }));
    fireEvent.click(screen.getByRole("button", { name: "Devam — onay" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0];
    expect(Array.isArray(arg.target)).toBe(false);
    expect(arg.target.host).toBe("GBWASP01");
    expect(arg.operation).toBe("stop");
    expect(arg.discovery).toMatchObject({ jobId: 501, awxServerId: 1 });
  });

  it("V2 islemler olculen duruma gore acilir: RUNNING -> Durdur/Restart, Baslat kapali; STOPPED -> yalniz Baslat", async () => {
    mockDiscoverStatus.mockResolvedValue(
      statusWith([
        target(),
        target({ host: "GBWASP02", cell: "CELL02", node: "NODE02", state: "STOPPED", pids: 0, ss: "ULASILAMIYOR", allowedOps: ["start"] }),
      ]),
    );
    render(<WasJvmSelectStep app="APPX" hostInfo={HOST_INFO} onSubmit={vi.fn()} />);
    const radios = await screen.findAllByRole("radio");

    const devam = screen.getByRole("button", { name: "Devam — onay" });
    expect(devam).toBeDisabled();

    fireEvent.click(radios[0]);
    expect(screen.getByRole("button", { name: "Durdur" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restart Et" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Başlat" })).toBeDisabled();
    expect(devam).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Durdur" }));
    expect(devam).toBeEnabled();

    // TEK secim: ikinci satir secilince birincisi birakilir ve islem secimi sifirlanir.
    fireEvent.click(radios[1]);
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
    expect(devam).toBeDisabled();
    expect(screen.getByRole("button", { name: "Durdur" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restart Et" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Başlat" })).toBeEnabled();
  });

  it("V3 resume verilirse YENI kesif isi acilmaz, ayni is yeniden okunur", async () => {
    mockDiscoverStatus.mockResolvedValue(statusWith([target()]));
    render(
      <WasJvmSelectStep app="APPX" hostInfo={HOST_INFO} resume={{ jobId: 777, awxServerId: 2 }} onSubmit={vi.fn()} />,
    );
    await screen.findAllByRole("radio");
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(mockDiscoverStatus).toHaveBeenCalledWith(2, 777);

    // "Keşfi yenile" her zaman YENI is acar.
    fireEvent.click(screen.getByRole("button", { name: "Keşfi yenile" }));
    await waitFor(() => expect(mockDiscover).toHaveBeenCalledTimes(1));
  });
});

describe("WasConfirmStep", () => {
  it("V4 JVM adi birebir + onay kutusu; yapistirma engellenir", () => {
    const onConfirm = vi.fn();
    render(<WasConfirmStep app="APPX" target={target()} operation="stop" env="Production" onConfirm={onConfirm} />);
    const input = screen.getByLabelText(/Onaylamak için JVM adını yazın/);
    const consent = screen.getByRole("checkbox", { name: /sonuçlarını kabul ediyorum/ });
    const button = screen.getByRole("button", { name: /Durdur: APPX @ GBWASP01/ });

    expect(input).toHaveValue("");
    expect(button).toBeDisabled();
    expect(screen.getByText("PRODUCTION")).toBeInTheDocument();

    // Yapistirma ve surukle-birak engelli.
    expect(fireEvent.paste(input)).toBe(false);
    expect(fireEvent.drop(input)).toBe(false);

    fireEvent.change(input, { target: { value: "appx" } });
    fireEvent.click(consent);
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "APPX" } });
    expect(button).toBeEnabled();
    fireEvent.click(consent);
    expect(button).toBeDisabled();
    fireEvent.click(consent);

    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith({ confirmed: true, confirmText: "APPX", ackWarnings: false });
  });

  it("V4b uyari varsa ayrica kabul edilmeden dugme acilmaz", () => {
    const onConfirm = vi.fn();
    const t = target({
      state: "ASKIDA",
      ss: "ULASILAMIYOR",
      warnings: { stop: [{ code: "ASKIDA", message: "JVM süreci var ama sunucu yanıt vermiyor (ASKIDA)." }], restart: [], start: [] },
    });
    render(<WasConfirmStep app="APPX" target={t} operation="stop" env="Test" onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/Onaylamak için JVM adını yazın/), { target: { value: "APPX" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /sonuçlarını kabul ediyorum/ }));
    const button = screen.getByRole("button", { name: /Durdur: APPX @ GBWASP01/ });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Uyarıları okudum/ }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith({ confirmed: true, confirmText: "APPX", ackWarnings: true });
  });
});

describe("WasResultPanel", () => {
  it("V5 OLCULEMEDI sari 'gercek durum bilinmiyor'; olculmemis once/sonra '—', Durmus degil", () => {
    const run: WasRunStatus = {
      ok: true,
      status: "failed",
      severity: "unknown",
      result: {
        host: "GBWASP01",
        profile: "AppSrv01",
        cell: "CELL01",
        node: "NODE01",
        server: "APPX",
        op: "stop",
        before: "RUNNING",
        after: "",
        result: "OLCULEMEDI",
        steps: [{ step: "stop_dogrula", status: "OLCULEMEDI", msg: "serverStatus yanitsiz" }],
        line: "RESULT\tstop\tOLCULEMEDI\tRUNNING\t-\tson durum bilinmiyor",
      },
    };
    render(
      <WasResultPanel
        target={target()}
        operation="stop"
        env="Production"
        jobId={9001}
        awxStatus="failed"
        output=""
        run={run}
        title="OpsX WAS #9001"
        onNew={vi.fn()}
      />,
    );
    const head = screen.getByText("Ölçülemedi — gerçek durum bilinmiyor");
    expect(head.closest("div.rounded-xl")?.className).toMatch(/yellow/);
    expect(screen.getByText(/envantere\s+yazılmadı/)).toBeInTheDocument();
    expect(screen.queryByText("Durmuş")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // 2026-10-02 duzeltici turu: STEP durumu adimin HEDEFINE ulasip ulasmadigidir; "UYARI:" ile
  // baslayan OK adim yesil "Basarili" degil sari "Uyari"; hedefe ulasmayan dogrulama FAIL.
  it("V6 'UYARI:' adimi sari Uyari, hedefe ulasmayan dogrulama Basarisiz; baslatma uyarisi gosterilir", () => {
    const run: WasRunStatus = {
      ok: true,
      status: "failed",
      severity: "fail",
      result: {
        host: "GBWASP01",
        profile: "AppSrv01",
        cell: "CELL01",
        node: "NODE01",
        server: "APPX",
        op: "stop",
        before: "RUNNING",
        after: "RUNNING",
        result: "FAIL",
        steps: [
          { step: "nodeagent", status: "OK", msg: "UYARI: nodeagent sureci yok", warning: true },
          { step: "stop_dogrulama", status: "FAIL", msg: "RUNNING: pid 42" },
          { step: "once", status: "OK", msg: "RUNNING: pid 42" },
        ],
        line: "RESULT\tstop\tFAIL\tRUNNING\tRUNNING\tdurdurulamadi",
      },
    };
    render(
      <WasResultPanel
        target={target()}
        operation="stop"
        env="Production"
        jobId={9002}
        awxStatus="failed"
        output=""
        run={run}
        title="OpsX WAS #9002"
        onNew={vi.fn()}
        launchWarning="İşlem başlatıldı (AWX #9002) ancak kaydı Portal veritabanına yazılamadı"
      />,
    );
    const rozet = (adim: string) => screen.getByText(adim).previousElementSibling as HTMLElement;
    expect(rozet("nodeagent").textContent).toBe("Uyarı");
    expect(rozet("nodeagent").className).toMatch(/yellow/);
    expect(rozet("stop_dogrulama").textContent).toBe("Başarısız");
    expect(rozet("once").textContent).toBe("Başarılı");
    expect(screen.getByText(/kaydı Portal veritabanına yazılamadı/)).toBeInTheDocument();
  });

  it("V7 kume '?' ad gibi gosterilmez: 'kume bilgisi olculemedi'", () => {
    const onConfirm = vi.fn();
    render(
      <WasConfirmStep
        app="APPX"
        target={target({ cluster: "?", peers: { total: 1, running: 0, unknown: 1, clusterKnown: false } })}
        operation="stop"
        env="Production"
        busy={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/küme bilgisi ölçülemedi/)).toBeInTheDocument();
    expect(screen.queryByText(/^\?\s·/)).toBeNull();
  });
});
