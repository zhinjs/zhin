import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
    Users,
    BarChart3,
    FileText,
    Settings,
    TrendingUp
} from "lucide-react"

export default function DashboardHome() {
    const stats = [
        {
            title: "总用户数",
            value: "1,234",
            change: "+12.5%",
            icon: Users,
            gradient: "from-blue-500 to-cyan-500",
        },
        {
            title: "今日访问",
            value: "5,678",
            change: "+8.2%",
            icon: BarChart3,
            gradient: "from-green-500 to-emerald-500",
        },
        {
            title: "文档数量",
            value: "89",
            change: "+3.1%",
            icon: FileText,
            gradient: "from-purple-500 to-pink-500",
        },
        {
            title: "系统状态",
            value: "正常",
            change: "100%",
            icon: Settings,
            gradient: "from-orange-500 to-red-500",
        }
    ]

    return (
        <div className="space-y-8">
            {/* 欢迎区域 */}
            <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                    仪表板
                </h1>
                <p className="text-gray-500 mt-2">欢迎回来！这里是您的控制台概览</p>
            </div>

            {/* 现代化统计卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => {
                    const Icon = stat.icon
                    return (
                        <Card 
                            key={index} 
                            className="border-0 bg-white/60 backdrop-blur-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                        >
                            <CardContent className="p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div className={`p-3 rounded-2xl bg-gradient-to-br ${stat.gradient} shadow-lg`}>
                                        <Icon className="w-6 h-6 text-white" />
                                    </div>
                                    <div className="flex items-center space-x-1 text-green-600">
                                        <TrendingUp className="w-4 h-4" />
                                        <span className="text-sm font-semibold">{stat.change}</span>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-gray-500 mb-1">{stat.title}</p>
                                    <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            {/* 主要内容区域 - 现代化设计 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 最近活动 */}
                <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg">
                    <CardHeader>
                        <CardTitle>最近活动</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {[
                                { label: "新用户注册", time: "2 分钟前", color: "bg-green-500" },
                                { label: "文档更新", time: "5 分钟前", color: "bg-blue-500" },
                                { label: "系统维护", time: "1 小时前", color: "bg-yellow-500" },
                                { label: "数据备份", time: "2 小时前", color: "bg-purple-500" }
                            ].map((activity, index) => (
                                <div key={index} className="flex items-center space-x-4 p-3 rounded-xl hover:bg-gray-50/50 transition-colors">
                                    <div className={`w-2 h-2 ${activity.color} rounded-full animate-pulse`}></div>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-gray-900">{activity.label}</p>
                                        <p className="text-xs text-gray-500">{activity.time}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* 快速操作 */}
                <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg">
                    <CardHeader>
                        <CardTitle>快速操作</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                            {[
                                { icon: Users, label: "用户管理", gradient: "from-blue-500 to-cyan-500" },
                                { icon: FileText, label: "创建文档", gradient: "from-purple-500 to-pink-500" },
                                { icon: BarChart3, label: "查看报告", gradient: "from-green-500 to-emerald-500" },
                                { icon: Settings, label: "系统设置", gradient: "from-orange-500 to-red-500" }
                            ].map((action, index) => {
                                const ActionIcon = action.icon
                                return (
                                    <button 
                                        key={index}
                                        className="group p-6 rounded-2xl border-2 border-gray-100 hover:border-transparent bg-white hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                                    >
                                        <div className={`w-12 h-12 mx-auto mb-3 rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg`}>
                                            <ActionIcon className="w-6 h-6 text-white" />
                                        </div>
                                        <p className="text-sm font-semibold text-gray-700 group-hover:text-gray-900">{action.label}</p>
                                    </button>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
