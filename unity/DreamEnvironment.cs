using UnityEngine;

/// <summary>
/// Exemple d'utilisation : reagit aux changements de saison/chaos
/// pour modifier la scene VR (skybox, lumieres, particules...).
///
/// Attacher a un GameObject dans la scene.
/// </summary>
public class DreamEnvironment : MonoBehaviour
{
    [Header("References scene")]
    public Light directionalLight;
    public ParticleSystem chaosParticles;

    [Header("Couleurs par saison")]
    public Color printempsColor = new Color(0.53f, 0.94f, 0.67f);
    public Color eteColor       = new Color(0.99f, 0.88f, 0.28f);
    public Color automneColor   = new Color(0.98f, 0.57f, 0.24f);
    public Color hiverColor     = new Color(0.58f, 0.77f, 0.99f);

    private Color _targetColor;
    private float _targetIntensity = 1f;

    void OnEnable()
    {
        DreamReceiver.OnSeasonChanged += HandleSeason;
        DreamReceiver.OnChaosChanged  += HandleChaos;
    }

    void OnDisable()
    {
        DreamReceiver.OnSeasonChanged -= HandleSeason;
        DreamReceiver.OnChaosChanged  -= HandleChaos;
    }

    void Start()
    {
        _targetColor = printempsColor;
        if (directionalLight == null)
            directionalLight = FindFirstObjectByType<Light>();
    }

    void Update()
    {
        if (directionalLight != null)
        {
            directionalLight.color = Color.Lerp(directionalLight.color, _targetColor, Time.deltaTime * 2f);
            directionalLight.intensity = Mathf.Lerp(directionalLight.intensity, _targetIntensity, Time.deltaTime * 3f);
        }
    }

    void HandleSeason(string season)
    {
        Debug.Log("[ENV] Saison: " + season);

        switch (season)
        {
            case "printemps": _targetColor = printempsColor; break;
            case "ete":       _targetColor = eteColor;       break;
            case "automne":   _targetColor = automneColor;   break;
            case "hiver":     _targetColor = hiverColor;     break;
        }
    }

    void HandleChaos(bool active)
    {
        Debug.Log("[ENV] Chaos: " + active);

        _targetIntensity = active ? 2.5f : 1f;

        if (chaosParticles != null)
        {
            if (active) chaosParticles.Play();
            else chaosParticles.Stop();
        }
    }
}
