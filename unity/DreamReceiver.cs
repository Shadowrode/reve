using UnityEngine;
using SocketIOClient; // NuGet: SocketIOClient (https://github.com/doghappy/socket.io-client-csharp)
using System;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

/// <summary>
/// Se connecte au serveur MANIPULATION et recoit les commandes de la foule.
///
/// SETUP:
/// 1. Installer via NuGet/UPM : SocketIOClient + Newtonsoft.Json
///    (ou utiliser le package Unity "NativeWebSocket" + parser JSON manuel)
/// 2. Attacher ce script a un GameObject vide "NetworkManager"
/// 3. Renseigner serverUrl = l'adresse de ton serveur (ex: http://192.168.1.42:3000)
/// </summary>
public class DreamReceiver : MonoBehaviour
{
    [Header("Serveur")]
    [Tooltip("URL du serveur Node.js (ex: http://localhost:3000)")]
    public string serverUrl = "http://localhost:3000";

    [Header("Etat actuel (lecture seule)")]
    public string currentSeason = "printemps";
    public bool chaosActive = false;
    public int spectatorCount = 0;

    // Evenements Unity auxquels d'autres scripts peuvent s'abonner
    public static event Action<string> OnSeasonChanged;
    public static event Action<bool> OnChaosChanged;
    public static event Action<int> OnSpectatorCountChanged;

    private SocketIO _socket;
    private bool _pendingSeasonUpdate = false;
    private string _pendingSeason;
    private bool _pendingChaosUpdate = false;
    private bool _pendingChaos;
    private bool _pendingCountUpdate = false;
    private int _pendingCount;

    async void Start()
    {
        _socket = new SocketIO(serverUrl, new SocketIOOptions
        {
            Query = new[] { KeyValuePair.Create("role", "unity") },
            Reconnection = true,
            ReconnectionDelay = 2000
        });

        _socket.OnConnected += (sender, e) =>
        {
            Debug.Log("[MANIPULATION] Connecte au serveur: " + serverUrl);
        };

        _socket.OnDisconnected += (sender, e) =>
        {
            Debug.Log("[MANIPULATION] Deconnecte du serveur");
        };

        // Reception de l'etat complet (a la connexion)
        _socket.On("state:sync", response =>
        {
            var data = response.GetValue<JObject>();
            string season = data["season"]?.ToString() ?? "printemps";
            bool chaos = data["chaos"]?.Value<bool>() ?? false;
            int count = data["spectators"]?.Value<int>() ?? 0;

            lock (this)
            {
                _pendingSeason = season;
                _pendingChaos = chaos;
                _pendingCount = count;
                _pendingSeasonUpdate = true;
                _pendingChaosUpdate = true;
                _pendingCountUpdate = true;
            }

            Debug.Log($"[MANIPULATION] Sync: saison={season} chaos={chaos} spectateurs={count}");
        });

        // Reception du resultat de vote (toutes les 10s)
        _socket.On("state:update", response =>
        {
            var data = response.GetValue<JObject>();
            string season = data["season"]?.ToString() ?? "printemps";
            bool chaos = data["chaos"]?.Value<bool>() ?? false;

            lock (this)
            {
                _pendingSeason = season;
                _pendingChaos = chaos;
                _pendingSeasonUpdate = true;
                _pendingChaosUpdate = true;
            }

            Debug.Log($"[MANIPULATION] Vote resolu: saison={season} chaos={chaos}");
        });

        // Mise a jour du nombre de spectateurs
        _socket.On("spectators:count", response =>
        {
            int count = response.GetValue<int>();
            lock (this)
            {
                _pendingCount = count;
                _pendingCountUpdate = true;
            }
        });

        try
        {
            await _socket.ConnectAsync();
        }
        catch (Exception ex)
        {
            Debug.LogError("[MANIPULATION] Erreur de connexion: " + ex.Message);
        }
    }

    // Les callbacks Socket arrivent sur un autre thread.
    // On dispatch les events Unity sur le main thread via Update().
    void Update()
    {
        lock (this)
        {
            if (_pendingSeasonUpdate)
            {
                _pendingSeasonUpdate = false;
                if (currentSeason != _pendingSeason)
                {
                    currentSeason = _pendingSeason;
                    OnSeasonChanged?.Invoke(currentSeason);
                }
            }

            if (_pendingChaosUpdate)
            {
                _pendingChaosUpdate = false;
                if (chaosActive != _pendingChaos)
                {
                    chaosActive = _pendingChaos;
                    OnChaosChanged?.Invoke(chaosActive);
                }
            }

            if (_pendingCountUpdate)
            {
                _pendingCountUpdate = false;
                spectatorCount = _pendingCount;
                OnSpectatorCountChanged?.Invoke(spectatorCount);
            }
        }
    }

    async void OnDestroy()
    {
        if (_socket != null)
        {
            await _socket.DisconnectAsync();
            _socket.Dispose();
        }
    }
}
