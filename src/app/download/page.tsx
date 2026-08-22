import { Card, Empty, SectionTitle } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { fmtBytes, modReleases } from '@/lib/mod-releases'
import { QQ_GROUP } from '@/lib/site'

export const dynamic = 'force-dynamic'

export const metadata = { title: '下载 · CE Stats' }

/**
 * Where the client mod is handed out.
 *
 * The jars are not built here — they come from the `mod/` half of the repo and get uploaded to
 * CESTATS_MOD_DIR by hand, so this page renders whatever is actually sitting in that directory
 * rather than a hardcoded list that could drift from reality.
 */
export default function DownloadPage() {
  const releases = modReleases()

  return (
    <div className="grid gap-9">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">下载</h1>
        <p className="mt-1 text-sm text-ink-400">
          CE Stats 客户端 mod · Fabric Mod Loader
        </p>
      </div>

      {releases.length === 0 ? (
        <Empty>
          还没有可下载的文件。把 <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">mod/dist/</code>{' '}
          里的 jar 上传到服务器的 <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">CESTATS_MOD_DIR</code>{' '}
          目录即可，这个页面会自动列出来。
        </Empty>
      ) : (
        <section>
          <SectionTitle
            title="客户端 mod"
            hint="「支持范围」是 jar 自己声明的，比文件名上的版本号更准"
          />
          <div className="grid gap-3">
            {releases.map((release, i) => (
              <Card key={release.file} i={i} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2.5">
                      <span className="num text-xl font-semibold tracking-tight text-ink-900">
                        {release.target ? `Minecraft ${release.target}` : release.file}
                      </span>
                      {release.version ? (
                        <span className="num text-xs text-ink-400">v{release.version}</span>
                      ) : null}
                    </div>

                    {release.supports ? (
                      <p className="mt-1.5 text-xs text-ink-500">
                        支持范围{' '}
                        <code className="num rounded bg-white/70 px-1.5 py-0.5">
                          {release.supports}
                        </code>
                      </p>
                    ) : null}

                    <p className="num mt-2 text-[11px] text-ink-300">
                      {fmtBytes(release.bytes)} · {fmtDate(release.modified)} · SHA-256{' '}
                      <span title={release.sha256}>{release.sha256.slice(0, 16)}…</span>
                    </p>
                  </div>

                  <a
                    href={`/api/mods/${encodeURIComponent(release.file)}`}
                    download
                    className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-ink-700"
                  >
                    下载 jar
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle title="安装" />
        <Card className="p-6">
          <ol className="grid gap-3.5 text-sm text-ink-700">
            <li className="flex gap-3">
              <span className="num shrink-0 text-ink-300">1</span>
              <span>
                [必需]装 <strong className="font-medium">Fabric Loader</strong>（0.16.0 以上）和对应版本的{' '}
                <strong className="font-medium">Fabric API</strong>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num shrink-0 text-ink-300">2</span>
              <span>
                把上面下载的 jar 丢进{' '}
                <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">.minecraft/mods/</code>。
                设置界面用的 Cloth Config (前置)已经打包在jar内。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num shrink-0 text-ink-300">3</span>
              <span>
                进游戏后执行{' '}
                <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">/cestats bind</code>
                ，聊天栏会给你一个 6 位<strong className="font-medium">绑定码</strong>（点一下就复制）。
                取码不需要审批，站点当场就发。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num shrink-0 text-ink-300">4</span>
              <span>
                在 QQ 群 <span className="num font-medium text-ink-900">{QQ_GROUP}</span> 里发{' '}
                <code className="rounded bg-white/70 px-1.5 py-0.5 text-xs">/配对 &lt;绑定码&gt;</code>
                ，机器人核对后批准，客户端 5 秒内自己完成配对，不用再输入任何东西。
                绑定码 20 分钟有效，<strong className="font-medium">可以公开发在群里</strong>——
                它只是一张申领单，设备令牌是站点直接回给你这台客户端的。
              </span>
            </li>
            <li className="flex gap-3">
              <span className="num shrink-0 text-ink-300">5</span>
              <span>
                连服打一把。赛后播报解析完会自动上传，比赛随后出现在{' '}
                <strong className="font-medium">比赛</strong> 页。
              </span>
            </li>
          </ol>

          <div className="mt-5 grid gap-2 border-t border-white/60 pt-4 text-xs text-ink-400">
            <p>
              mod 只在客户端运行，
              读的是聊天框里的赛后播报，不读内存也不改游戏行为，不存在作弊行为。
            </p>
            <p>
              进不了游戏、或者不想用 QQ 群：向站长要一个<strong className="font-medium">一次性配对码</strong>，
              执行 <code className="rounded bg-white/70 px-1.5 py-0.5">/cestats pair &lt;配对码&gt;</code>。
              配对码 15 分钟有效、只能用一次，且只有你这个 ID 能用。
            </p>
            <p>
              官方统计服务器不需要改地址。自部署统计站点的话，用{' '}
              <code className="rounded bg-white/70 px-1.5 py-0.5">/cestats url</code>{' '}
              填自己的地址再配对；装了 Mod Menu 也可以在它的设置界面里改。
            </p>
          </div>
        </Card>
      </section>
    </div>
  )
}
