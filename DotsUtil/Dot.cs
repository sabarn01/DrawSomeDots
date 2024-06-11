using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace DotsUtil
{
    class Dot
    {
        public Color DotColor { get; private set; }
        public Rectangle Rect { get; set; }
        private static Random Rnd;

        static Dot()
        {
            Rnd = new Random();
        }
        private int DotMin, DotMax, MaxX, MaxY, MinX, MinY;

        public Dot(int iDotMin, int iDotMax, int iMaxX, int iMaxY, int iMinX, int iMinY) :
            this(iDotMin, iDotMax, iMaxX, iMaxY)
        {
            MinX = iMinX;
            MinY = iMinY;
        }
            
        
        public Dot(int iDotMin,int iDotMax,int iMaxX, int iMaxY)
        {
            MaxX = iMaxX;
            MaxY = iMaxY;
            DotMin = iDotMin;
            DotMax = iDotMax;
            MinX = 0;
            MinY = 0;
            
            int R, G, B;
            
            R = Rnd.Next(0, 255);
            G = Rnd.Next(0, 255);
            B = Rnd.Next(0, 255);
            DotColor = Color.FromArgb(R, G, B);
        }

        public void FindPoint()
        {
            int w = MaxX;
            int h = MaxY;
            int sz = Rnd.Next(DotMin, DotMax);
            int x = Rnd.Next(MinX,w);
            int y = Rnd.Next(MinY,h);
            Rect  = new Rectangle(x,y,sz,sz);
            


        }
        

 
    }
    
}
