import yaml
import os

class Config:
    _instance = None
    _config = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            cls._load_config()
        return cls._instance

    @classmethod
    def _load_config(cls):
        config_path = os.path.join(os.path.dirname(__file__), 'config.yaml')
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cls._config = yaml.safe_load(f)
        except FileNotFoundError:
            cls._config = {}  # 如果配置文件不存在，使用空字典

    @classmethod
    def get(cls, key, default=None):
        """获取配置项，支持使用点号访问嵌套配置，如 'volc.access_key'"""
        if cls._config is None:
            cls._load_config()
        
        keys = key.split('.')
        value = cls._config
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default
        return value if value is not None else default

# 为了保持向后兼容性，保留原有的常量
VOLC_ACCESS_KEY = Config.get('volc.access_key', "9UwX58oSkTVpQVXV-1Uwok6tcQWPot8U")
VOLC_SECRET_KEY = Config.get('volc.secret_key', "pvC9Yfy8QyUO-3uRajGviQ_uoK8ZjZyj")
VOLC_APPID = Config.get('volc.app_id', "4673182595")
VOLC_CLUSTER = Config.get('volc.cluster', "volcengine_input_common") 